import fs from 'node:fs';
import { MAX_VOICE_MEMBERS, type DeckState, type VoiceMember } from '@deck/protocol';
import { z } from 'zod';
import type { Logger } from '../../../logger';
import type { StateStore } from '../../../state-store';
import { ActionError } from '../../types';
import { AvatarCache } from './avatars';
import { loadCredentials, refreshTokens, saveCredentials, type DiscordCredentials } from './credentials';
import { DiscordIpc, DiscordRpcError } from './ipc';

const RETRY_MS = 5000; // how often to look for Discord (or for setup) while not connected
const REFRESH_BEFORE_MS = 24 * 3600 * 1000; // refresh the login a day before it expires

// Discord's replies, reduced to the fields we use. Checked with zod like any input.
const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullish(),
  avatar: z.string().nullish(),
});
const VoiceStateSchema = z.object({
  nick: z.string().nullish(),
  user: UserSchema,
  voice_state: z
    .object({
      mute: z.boolean().optional(),
      deaf: z.boolean().optional(),
      self_mute: z.boolean().optional(),
      self_deaf: z.boolean().optional(),
    })
    .optional(),
});
const ChannelSchema = z.object({ id: z.string(), name: z.string().nullish(), voice_states: z.array(VoiceStateSchema).optional() });
const AuthSchema = z.object({ user: UserSchema });
const SettingsSchema = z.object({ mute: z.boolean().optional(), deaf: z.boolean().optional() });
const ChannelSelectSchema = z.object({ channel_id: z.string().nullish() });
const SpeakingSchema = z.object({ user_id: z.string() });
/** A desktop notification; only the fields needed to spot a call (never the text). */
const NotificationSchema = z.object({
  channel_id: z.string(),
  message: z.object({
    type: z.number(),
    nick: z.string().nullish(),
    author: UserSchema.nullish(),
  }),
});

const MESSAGE_TYPE_CALL = 3; // Discord message type for "X started a call"
const RING_TIMEOUT_MS = 60_000; // Discord rings for less than this
const RING_CHECK_MS = 2000;

/** Voice-channel events we follow for the current channel. */
const CHANNEL_EVENTS = ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP'];

interface Member {
  id: string;
  name: string;
  avatarHash: string | null;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
}

/**
 * Live Discord voice state (mute, deafen, the channel we're in and who's talking)
 * through Discord's local RPC, plus the mute/deafen actions.
 *
 * Keeps retrying in the background: picks Discord up when it starts, and picks up
 * `npm run discord:setup` without restarting the agent.
 */
export class DiscordVoice {
  private ipc: DiscordIpc | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private connecting = false;
  private lastProblem = '';
  private activeRefreshToken: string | undefined;
  private ringing: {
    channelId: string;
    name: string;
    userId: string | null;
    avatarHash: string | null;
    sawCaller: boolean;
  } | null = null;
  private ringTimers: NodeJS.Timeout[] = [];

  private link: DeckState['voice']['link'] = 'offline';
  private selfId: string | null = null;
  private settings = { mute: false, deaf: false };
  private channel: { id: string; name: string } | null = null;
  private members = new Map<string, Member>();
  private avatars: AvatarCache;

  constructor(
    private readonly credentialsPath: string,
    private readonly store: StateStore,
    private readonly log: Logger,
    /** Tests only: a fake Discord pipe, and no avatar downloads. */
    private readonly testPipe?: string,
  ) {
    this.avatars = new AvatarCache(log, () => this.publish(), !testPipe);
  }

  start(): void {
    this.stopped = false;
    // Re-running discord:setup rewrites discord.json: reconnect with the new login.
    fs.watchFile(this.credentialsPath, { interval: 2000 }, () => this.onCredentialsFileChanged());
    void this.tryConnect();
  }

  stop(): void {
    this.stopped = true;
    fs.unwatchFile(this.credentialsPath);
    this.stopRinging();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ipc?.close();
    this.ipc = null;
  }

  private onCredentialsFileChanged(): void {
    const creds = loadCredentials(this.credentialsPath);
    // Our own token refresh also writes the file; same refresh token = nothing new.
    if (!this.ipc || !creds || creds.refreshToken === this.activeRefreshToken) return;
    this.log.info('Discord: new login found, reconnecting');
    this.ipc.close();
    this.ipc = null;
    this.resetVoice();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.tryConnect();
  }

  async toggleMute(): Promise<void> {
    await this.setSettings({ mute: !this.settings.mute });
  }

  async toggleDeafen(): Promise<void> {
    await this.setSettings({ deaf: !this.settings.deaf });
  }

  // ---------------------------------------------------------------------------
  // Connecting

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.tryConnect();
    }, RETRY_MS);
  }

  private async tryConnect(): Promise<void> {
    if (this.stopped || this.connecting || this.ipc) return;
    this.connecting = true;
    try {
      await this.connect();
      this.lastProblem = '';
    } catch (err) {
      // connect() may have set this.ipc before failing (TypeScript can't see that).
      (this.ipc as DiscordIpc | null)?.close();
      this.ipc = null;
      this.resetVoice();
      // Log each new kind of problem once, not every 5 seconds.
      const problem = err instanceof Error ? err.message : String(err);
      if (problem !== this.lastProblem) {
        this.lastProblem = problem;
        this.log.info(`Discord: ${problem}`);
      }
      this.scheduleRetry();
    } finally {
      this.connecting = false;
    }
  }

  private async connect(): Promise<void> {
    let creds = loadCredentials(this.credentialsPath);
    if (!creds?.refreshToken) {
      this.setLink('notSetUp');
      throw new Error('not set up yet (run "npm run discord:setup" to link it)');
    }

    const ipc = new DiscordIpc();
    try {
      await ipc.connect(creds.clientId, this.testPipe);
    } catch (err) {
      this.setLink(err instanceof DiscordRpcError ? 'notSetUp' : 'offline');
      throw err;
    }
    this.ipc = ipc;

    // Log in with our saved token (refreshing it when it's about to expire).
    let auth: unknown;
    try {
      if (!creds.accessToken || (creds.expiresAt ?? 0) - Date.now() < REFRESH_BEFORE_MS) creds = await this.refresh(creds);
      auth = await this.authenticate(creds);
    } catch (err) {
      if (!(err instanceof DiscordRpcError)) throw err;
      // Token rejected: try once with a fresh one.
      try {
        creds = await this.refresh(creds);
        auth = await this.authenticate(creds);
      } catch {
        this.setLink('notSetUp');
        throw new Error('the Discord login expired; run "npm run discord:setup" again');
      }
    }
    this.selfId = AuthSchema.parse(auth).user.id;
    this.activeRefreshToken = creds.refreshToken;

    ipc.onEvent = (evt, data) => this.onEvent(evt, data);
    ipc.onClose = () => {
      this.log.info('Discord: connection closed');
      this.ipc = null;
      this.resetVoice();
      this.setLink('offline');
      this.scheduleRetry();
    };

    await ipc.subscribe('VOICE_SETTINGS_UPDATE');
    await ipc.subscribe('VOICE_CHANNEL_SELECT');
    // Optional (incoming calls): needs the rpc.notifications.read scope; older logins lack it.
    await ipc.subscribe('NOTIFICATION_CREATE').catch(() => {
      this.log.info('Discord: notifications not allowed by this login (run "npm run discord:setup" again to add them)');
    });
    this.applySettings(await ipc.request('GET_VOICE_SETTINGS'));
    await this.loadChannel();
    this.link = 'connected';
    this.publish();
    this.log.info('Discord: connected');
  }

  private async refresh(creds: DiscordCredentials): Promise<DiscordCredentials> {
    const fresh = await refreshTokens(creds);
    this.activeRefreshToken = fresh.refreshToken; // before saving, so the file watcher ignores our own write
    saveCredentials(this.credentialsPath, fresh); // the old refresh token stops working
    return fresh;
  }

  private authenticate(creds: DiscordCredentials): Promise<unknown> {
    return this.ipc!.request('AUTHENTICATE', { access_token: creds.accessToken });
  }

  // ---------------------------------------------------------------------------
  // Voice state

  private onEvent(evt: string, data: unknown): void {
    switch (evt) {
      case 'VOICE_SETTINGS_UPDATE':
        this.applySettings(data);
        break;
      case 'VOICE_CHANNEL_SELECT': {
        const sel = ChannelSelectSchema.safeParse(data);
        // Answered in Discord itself (or on the deck): stop ringing.
        if (sel.success && this.ringing && sel.data.channel_id === this.ringing.channelId) this.stopRinging();
        if (sel.success && (sel.data.channel_id ?? null) !== (this.channel?.id ?? null)) {
          void this.loadChannel().catch((err: unknown) => this.log.warn({ err }, 'Discord: could not read voice channel'));
        }
        return; // loadChannel publishes
      }
      case 'VOICE_STATE_CREATE':
      case 'VOICE_STATE_UPDATE': {
        const vs = VoiceStateSchema.safeParse(data);
        if (vs.success) this.upsertMember(vs.data);
        break;
      }
      case 'VOICE_STATE_DELETE': {
        const vs = VoiceStateSchema.safeParse(data);
        if (vs.success) this.members.delete(vs.data.user.id);
        break;
      }
      case 'NOTIFICATION_CREATE':
        this.onNotification(data);
        return;
      case 'SPEAKING_START':
      case 'SPEAKING_STOP': {
        const sp = SpeakingSchema.safeParse(data);
        const m = sp.success ? this.members.get(sp.data.user_id) : undefined;
        if (m) m.speaking = evt === 'SPEAKING_START';
        break;
      }
      default:
        return;
    }
    this.publish();
  }

  // ---------------------------------------------------------------------------
  // Incoming calls
  //
  // Discord has no "incoming call" event, but a ringing call shows a desktop
  // notification whose message has type 3 (CALL) and the call's channel id.
  // There's also no "stopped ringing" event, so ringing ends when we join the
  // call, the caller leaves it (checked every 2 s), we dismiss it, or after a minute.

  private onNotification(data: unknown): void {
    const n = NotificationSchema.safeParse(data);
    if (!n.success || n.data.message.type !== MESSAGE_TYPE_CALL) return; // a normal message
    const author = n.data.message.author;
    if (author?.id === this.selfId) return; // a call we started ourselves
    this.stopRinging();
    this.ringing = {
      channelId: n.data.channel_id,
      name: n.data.message.nick || author?.global_name || author?.username || 'Someone',
      userId: author?.id ?? null,
      avatarHash: author?.avatar ?? null,
      sawCaller: false,
    };
    this.log.info('Discord: incoming call');
    this.ringTimers.push(setTimeout(() => this.stopRinging(), RING_TIMEOUT_MS));
    this.ringTimers.push(setInterval(() => void this.checkCallerStillThere(), RING_CHECK_MS));
    this.publish();
  }

  /** The caller hung up before we answered: their voice state is gone from the call's channel. */
  private async checkCallerStillThere(): Promise<void> {
    const ringing = this.ringing;
    if (!ringing || !this.ipc) return;
    try {
      const raw = await this.ipc.request('GET_CHANNEL', { channel_id: ringing.channelId });
      const ch = ChannelSchema.safeParse(raw);
      if (!ch.success || !ch.data.voice_states || this.ringing !== ringing) return;
      if (ch.data.voice_states.length > 0) ringing.sawCaller = true;
      // Only trust "empty" after we've seen someone there (in case Discord is slow to list them).
      else if (ringing.sawCaller) this.stopRinging();
    } catch {
      // can't tell; the timeout ends it
    }
  }

  async answerCall(): Promise<void> {
    const ringing = this.ringing;
    if (!ringing) throw new ActionError('Nobody is calling');
    if (!this.ipc) throw new ActionError('Discord is not running');
    try {
      // force: also works while we're in another voice channel (moves us, like Discord's Accept button).
      await this.ipc.request('SELECT_VOICE_CHANNEL', { channel_id: ringing.channelId, force: true }, undefined, 10_000);
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'Discord: could not answer the call');
      throw new ActionError('Discord did not join the call');
    }
    this.stopRinging();
  }

  dismissCall(): void {
    this.stopRinging();
  }

  private stopRinging(): void {
    for (const t of this.ringTimers) clearTimeout(t); // clearTimeout also clears intervals
    this.ringTimers = [];
    if (!this.ringing) return;
    this.ringing = null;
    this.publish();
  }

  private applySettings(data: unknown): void {
    const s = SettingsSchema.safeParse(data);
    if (!s.success) return;
    if (s.data.mute !== undefined) this.settings.mute = s.data.mute;
    if (s.data.deaf !== undefined) this.settings.deaf = s.data.deaf;
  }

  /** Reads the channel we're in (if any) and follows its events instead of the old one's. */
  private async loadChannel(): Promise<void> {
    const ipc = this.ipc;
    if (!ipc) return;
    if (this.channel) {
      const old = { channel_id: this.channel.id };
      await Promise.all(CHANNEL_EVENTS.map((e) => ipc.unsubscribe(e, old).catch(() => {})));
    }
    this.channel = null;
    this.members.clear();

    const raw = await ipc.request('GET_SELECTED_VOICE_CHANNEL');
    const parsed = raw === null ? null : ChannelSchema.safeParse(raw);
    if (parsed?.success) {
      const ch = parsed.data;
      this.channel = { id: ch.id, name: ch.name || 'Voice' };
      for (const vs of ch.voice_states ?? []) this.upsertMember(vs);
      await Promise.all(CHANNEL_EVENTS.map((e) => ipc.subscribe(e, { channel_id: ch.id })));
    }
    this.publish();
  }

  private upsertMember(vs: z.infer<typeof VoiceStateSchema>): void {
    const v = vs.voice_state ?? {};
    const prev = this.members.get(vs.user.id);
    this.members.set(vs.user.id, {
      id: vs.user.id,
      name: vs.nick || vs.user.global_name || vs.user.username,
      avatarHash: vs.user.avatar ?? null,
      muted: Boolean(v.mute || v.self_mute),
      deafened: Boolean(v.deaf || v.self_deaf),
      speaking: prev?.speaking ?? false,
    });
  }

  private async setSettings(change: { mute?: boolean; deaf?: boolean }): Promise<void> {
    if (!this.ipc || this.link !== 'connected') {
      throw new ActionError(
        this.link === 'notSetUp' ? 'Discord is not linked yet: run "npm run discord:setup" on the PC' : 'Discord is not running',
      );
    }
    try {
      this.applySettings(await this.ipc.request('SET_VOICE_SETTINGS', change));
    } catch (err) {
      this.log.warn({ err: (err as Error).message }, 'Discord: could not change voice settings');
      throw new ActionError('Discord did not accept the change');
    }
    this.publish();
  }

  private resetVoice(): void {
    this.stopRinging();
    this.channel = null;
    this.members.clear();
    this.settings = { mute: false, deaf: false };
  }

  private setLink(link: DeckState['voice']['link']): void {
    this.link = link;
    this.publish();
  }

  /** Sends the current voice state to the tablet (the store skips unchanged snapshots). */
  private publish(): void {
    const all = [...this.members.values()];
    // Others first (in channel order), us last: the squad key shows the first few.
    const ordered = [...all.filter((m) => m.id !== this.selfId), ...all.filter((m) => m.id === this.selfId)];
    const members: VoiceMember[] = ordered.slice(0, MAX_VOICE_MEMBERS).map((m) => ({
      id: m.id,
      name: m.name,
      avatarUrl: this.avatars.get(m.id, m.avatarHash),
      speaking: m.speaking,
      muted: m.muted,
      deafened: m.deafened,
    }));
    const connected = this.link === 'connected';
    this.store.set('voice', {
      link: this.link,
      micMuted: connected && (this.settings.mute || this.settings.deaf), // deafen also mutes in Discord
      deafened: connected && this.settings.deaf,
      channel: connected && this.channel ? { name: this.channel.name, memberCount: all.length } : null,
      members: connected && this.channel ? members : [],
      incomingCall:
        connected && this.ringing
          ? {
              name: this.ringing.name,
              avatarUrl: this.ringing.userId ? this.avatars.get(this.ringing.userId, this.ringing.avatarHash) : null,
            }
          : null,
    });
  }
}
