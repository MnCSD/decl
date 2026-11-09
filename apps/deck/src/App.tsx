// Import each weight from its own folder so only these 5 font files get bundled (not all 36).
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { parseLayout, type DeckLayout } from '@deck/protocol';
import { useFonts } from 'expo-font';
import { useKeepAwake } from 'expo-keep-awake';
import { NavigationBar } from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import layoutJson from './config/default-layout.json';
import { useDeck } from './connection/useDeck';
import { DeckScreen } from './screens/DeckScreen';
import { PairScreen } from './screens/PairScreen';
import { CANVAS, colors, fonts } from './theme';

// Validate the layout JSON once at startup; a mistake shows an error screen instead of crashing.
const layoutResult = parseLayout(layoutJson);

export default function App() {
  useKeepAwake(); // keep the screen on while the app is open

  useEffect(() => {
    // Fails harmlessly where locking isn't supported (e.g. desktop browser preview).
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  const [fontsLoaded] = useFonts({
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  return (
    <View style={styles.root}>
      {/* Immersive fullscreen: hide the Android status bar and navigation bar. */}
      <StatusBar hidden />
      <NavigationBar hidden />
      {!fontsLoaded ? null : layoutResult.ok ? (
        <ScaleToFit>
          <Main layout={layoutResult.layout} />
        </ScaleToFit>
      ) : (
        <LayoutError message={layoutResult.error} />
      )}
    </View>
  );
}

/** Pairing screen until we have a PC, then the live deck. */
function Main({ layout }: { layout: DeckLayout }) {
  const deck = useDeck();
  if (deck.phase === 'loading') return null; // reading saved pairing; takes a few ms
  if (deck.phase === 'unpaired') return <PairScreen onPair={deck.pair} notice={deck.unpairedReason} />;
  return (
    <DeckScreen
      layout={layout}
      state={deck.state}
      status={deck.status}
      appIcons={deck.icons}
      onKeyPress={(key) => void deck.pressKey(key)}
      onAdjust={deck.adjust}
      onForgetPc={() => void deck.forget()}
    />
  );
}

/**
 * The UI is designed at 1340×800. This scales it uniformly to fit whatever
 * screen it runs on, keeping proportions (and centering any leftover space).
 */
function ScaleToFit({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(width / CANVAS.width, height / CANVAS.height);
  return (
    <View
      style={{
        position: 'absolute',
        width: CANVAS.width,
        height: CANVAS.height,
        left: (width - CANVAS.width) / 2,
        top: (height - CANVAS.height) / 2,
        transform: [{ scale }],
      }}
    >
      {children}
    </View>
  );
}

function LayoutError({ message }: { message: string }) {
  return (
    <ScrollView contentContainerStyle={styles.error}>
      <Text style={styles.errorTitle}>Layout file has a problem</Text>
      <Text style={styles.errorText}>{message}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  error: { padding: 48, gap: 12 },
  errorTitle: { fontFamily: fonts.ui700, fontSize: 22, color: colors.text },
  errorText: { fontFamily: fonts.mono400, fontSize: 14, color: '#FF5466' },
});
