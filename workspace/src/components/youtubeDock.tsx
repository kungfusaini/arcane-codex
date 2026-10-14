"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type YouTubeDockSession = {
  sourceBlockId: string;
  videoId: string;
  url: string;
  title: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isVisible: boolean;
};

type Listener = () => void;
type YouTubeDockCommand = {
  sourceBlockId: string;
  command: 'playVideo' | 'pauseVideo' | 'getCurrentTime' | 'getDuration' | 'seekTo';
  args?: unknown[];
};

type CommandListener = (command: YouTubeDockCommand) => void;

let session: YouTubeDockSession | null = null;
const listeners = new Set<Listener>();
const commandListeners = new Set<CommandListener>();

function emit() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      listeners.delete(listener);
    }
  }
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return session;
}

export function useYouTubeDockSession() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setYouTubeDockSession(next: YouTubeDockSession | null) {
  session = next;
  emit();
}

export function clearYouTubeDockSession(sourceBlockId?: string) {
  if (!session) return;
  if (sourceBlockId && session.sourceBlockId !== sourceBlockId) return;
  session = null;
  emit();
}

export function updateYouTubeDockSession(partial: Partial<YouTubeDockSession>) {
  if (!session) return;
  const next = { ...session, ...partial };
  const changed = (Object.keys(partial) as Array<keyof YouTubeDockSession>).some((key) => session?.[key] !== next[key]);
  if (!changed) return;
  session = next;
  emit();
}

export function requestYouTubeDockCommand(command: YouTubeDockCommand) {
  for (const listener of [...commandListeners]) {
    try {
      listener(command);
    } catch {
      commandListeners.delete(listener);
    }
  }
}

export function YouTubeMiniPlayerDock() {
  const dockSession = useYouTubeDockSession();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const wholeSeconds = Math.floor(seconds);
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
  };

  const sendCommand = useCallback((command: 'playVideo' | 'pauseVideo' | 'getCurrentTime' | 'getDuration' | 'seekTo', args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: command, args }), '*');
  }, []);

  useEffect(() => {
    setCurrentTime(dockSession?.currentTime ?? 0);
    setDuration(dockSession?.duration ?? 0);
    setIsPlaying(dockSession?.isPlaying ?? false);
  }, [dockSession?.currentTime, dockSession?.duration, dockSession?.isPlaying, dockSession?.videoId]);

  const dockSessionSourceBlockId = dockSession?.sourceBlockId;

  useEffect(() => {
    if (!dockSessionSourceBlockId) return;
    const handleCommand = (dockCommand: YouTubeDockCommand) => {
      if (dockCommand.sourceBlockId !== dockSessionSourceBlockId) return;
      sendCommand(dockCommand.command, dockCommand.args ?? []);
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || typeof event.data !== 'string') return;
      try {
        const payload = JSON.parse(event.data) as {
          event?: string;
          info?: { currentTime?: number; duration?: number } | number;
        };
        if (payload.event === 'infoDelivery' && payload.info && typeof payload.info === 'object') {
          if (typeof payload.info.currentTime === 'number') {
            setCurrentTime(payload.info.currentTime);
            updateYouTubeDockSession({ currentTime: payload.info.currentTime });
          }
          if (typeof payload.info.duration === 'number' && payload.info.duration > 0) {
            setDuration(payload.info.duration);
            updateYouTubeDockSession({ duration: payload.info.duration });
          }
        }
        if (payload.event === 'onStateChange' && typeof payload.info === 'number') {
          const nextPlaying = payload.info === 1 || payload.info === 3;
          setIsPlaying(nextPlaying);
          updateYouTubeDockSession({ isPlaying: nextPlaying });
        }
      } catch {
        // Ignore unrelated messages.
      }
    };

    const poll = window.setInterval(() => {
      sendCommand('getCurrentTime');
      sendCommand('getDuration');
    }, 500);

    commandListeners.add(handleCommand);
    window.addEventListener('message', handleMessage);
    return () => {
      commandListeners.delete(handleCommand);
      window.removeEventListener('message', handleMessage);
      window.clearInterval(poll);
    };
  }, [dockSessionSourceBlockId, dockSession?.videoId, sendCommand]);

  if (!dockSession) {
    return null;
  }

  const transport = (
    <iframe
        ref={iframeRef}
        onLoad={() => {
          const target = iframeRef.current?.contentWindow;
          target?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*');
          target?.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }), '*');
          sendCommand('seekTo', [dockSession.currentTime || 0, true]);
          if (dockSession.isPlaying) {
            sendCommand('playVideo');
          } else {
            sendCommand('pauseVideo');
          }
        }}
        className="youtube-transport youtube-mini-player-transport"
        src={`https://www.youtube-nocookie.com/embed/${dockSession.videoId}?rel=0&enablejsapi=1&origin=${encodeURIComponent(typeof window === 'undefined' ? '' : window.location.origin)}`}
        title="Mini music player"
        tabIndex={-1}
        aria-hidden="true"
        allow="autoplay; encrypted-media"
      />
  );

  return (
    <aside className={`youtube-mini-player ${dockSession.isVisible ? '' : 'youtube-mini-player--hidden'}`} aria-label="Mini music player">
      {transport}
      {dockSession.isVisible ? <button type="button" className="youtube-mini-player-main" onClick={() => {
        const nextPlaying = !isPlaying;
        setIsPlaying(nextPlaying);
        updateYouTubeDockSession({ isPlaying: nextPlaying });
        sendCommand(nextPlaying ? 'playVideo' : 'pauseVideo');
      }} aria-label={isPlaying ? 'Pause audio' : 'Play audio'}>
        <span className="youtube-mini-player-icon" aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>
        <span className="youtube-mini-player-copy">
          <strong>{dockSession.title}</strong>
          <span>{formatTime(currentTime)} / {duration ? formatTime(duration) : '--:--'}</span>
        </span>
      </button> : null}
      {dockSession.isVisible ? <input
        className="youtube-mini-player-seeker"
        type="range"
        min="0"
        max={duration || 240}
        step="1"
        value={Math.min(currentTime, duration || 1)}
        onChange={(event) => {
          const nextTime = Number(event.currentTarget.value);
          setCurrentTime(nextTime);
          updateYouTubeDockSession({ currentTime: nextTime });
          sendCommand('seekTo', [nextTime, true]);
        }}
        aria-label="Seek through audio"
      /> : null}
      {dockSession.isVisible ? <button type="button" className="youtube-mini-player-close" onClick={() => clearYouTubeDockSession(dockSession.sourceBlockId)} aria-label="Dismiss mini player">
        ×
      </button> : null}
    </aside>
  );
}
