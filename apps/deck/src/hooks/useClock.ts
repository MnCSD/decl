import { useEffect, useState } from 'react';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Tablet clock: { time: "21:47", date: "THU 06 NOV" }, refreshed every few seconds. */
export function useClock(): { time: string; date: string } {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(timer);
  }, []);

  return {
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    date: `${DAYS[now.getDay()]} ${pad(now.getDate())} ${MONTHS[now.getMonth()]}`,
  };
}
