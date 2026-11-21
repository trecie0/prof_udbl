import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BoardPointer,
  BoardStep,
  LiveConnectionState,
  TranscriptEntry,
} from '../types/board.ts';

interface ConnectOverrides {
  sessionId?: string;
  courseId?: string | null;
  moduleId?: string | null;
}

interface UseLiveProfessorOptions {
  sessionId: string | null;
  courseId?: string | null;
  moduleId?: string | null;
  model: string;
  voice: string;
  onBoardStepsUpdated: (steps: BoardStep[]) => void;
  onPointerMoved?: (pointer: BoardPointer) => void;
  onTeacherSpeech?: (chunk: string, fullTurnText: string) => void;
}

function float32ToInt16Base64(float32: Float32Array, sourceRate: number, targetRate = 16000): string {
  let samples: Float32Array;
  if (sourceRate === targetRate) {
    samples = float32;
  } else {
    const ratio = sourceRate / targetRate;
    const newLength = Math.max(1, Math.round(float32.length / ratio));
    samples = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const idx = i * ratio;
      const idxFloor = Math.floor(idx);
      const idxCeil = Math.min(float32.length - 1, idxFloor + 1);
      const weight = idx - idxFloor;
      samples[i] = float32[idxFloor] * (1 - weight) + float32[idxCeil] * weight;
    }
  }

  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToFloat32Pcm(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export function useLiveProfessor({
  sessionId,
  courseId,
  moduleId,
  model,
  voice,
  onBoardStepsUpdated,
  onPointerMoved,
  onTeacherSpeech,
}: UseLiveProfessorOptions) {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>('disconnected');
  const [isMicActive, setIsMicActive] = useState(false);
  const [isTeacherSpeaking, setIsTeacherSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const isMicActiveRef = useRef(false);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const outputCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const onBoardStepsUpdatedRef = useRef(onBoardStepsUpdated);
  const onPointerMovedRef = useRef(onPointerMoved);
  const onTeacherSpeechRef = useRef(onTeacherSpeech);
  const currentTeacherTurnRef = useRef('');

  useEffect(() => {
    onBoardStepsUpdatedRef.current = onBoardStepsUpdated;
  }, [onBoardStepsUpdated]);

  useEffect(() => {
    onPointerMovedRef.current = onPointerMoved;
  }, [onPointerMoved]);

  useEffect(() => {
    onTeacherSpeechRef.current = onTeacherSpeech;
  }, [onTeacherSpeech]);

  const appendTranscript = useCallback(
    (role: TranscriptEntry['role'], text: string) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      setTranscripts((prev) => {
        const last = prev[prev.length - 1];
        // Coalesce streaming transcript fragments from the same speaker
        if (last && last.role === role && role !== 'system') {
          const updated = [...prev];
          const needsSpace =
            !last.text.endsWith(' ') && !cleaned.startsWith(' ') && !/^[.,!?;:]/.test(cleaned);
          updated[updated.length - 1] = {
            ...last,
            text: `${last.text}${needsSpace ? ' ' : ''}${cleaned}`,
          };
          return updated;
        }
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role,
            text: cleaned,
            timestamp: new Date().toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
        ];
      });
    },
    [],
  );

  const stopAudioPlayback = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Ignore already stopped buffer source
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setIsTeacherSpeaking(false);
  }, []);

  const ensureOutputAudioContext = useCallback(async () => {
    if (!outputCtxRef.current || outputCtxRef.current.state === 'closed') {
      outputCtxRef.current = new AudioContext({ sampleRate: 24000 });
    }
    if (outputCtxRef.current.state === 'suspended') {
      await outputCtxRef.current.resume();
    }
    return outputCtxRef.current;
  }, []);

  const playPcm24kChunk = useCallback(
    async (base64Audio: string) => {
      try {
        const ctx = await ensureOutputAudioContext();
        const float32 = base64ToFloat32Pcm(base64Audio);
        if (float32.length === 0) return;

        const buffer = ctx.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);

        const now = ctx.currentTime;
        if (nextStartTimeRef.current < now) {
          nextStartTimeRef.current = now + 0.02;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
          activeSourcesRef.current.delete(source);
          if (activeSourcesRef.current.size === 0) {
            setIsTeacherSpeaking(false);
          }
        };

        activeSourcesRef.current.add(source);
        setIsTeacherSpeaking(true);
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buffer.duration;
      } catch (err) {
        console.error('Audio playback error:', err);
      }
    },
    [ensureOutputAudioContext],
  );

  const stopMicrophone = useCallback(() => {
    isMicActiveRef.current = false;
    setIsMicActive(false);
    setMicLevel(0);

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // Ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }

    if (inputCtxRef.current && inputCtxRef.current.state !== 'closed') {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    stopMicrophone();
    stopAudioPlayback();

    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'close' }));
        }
        ws.close();
      } catch {
        // Ignore
      }
    }
    setConnectionState('disconnected');
  }, [stopAudioPlayback, stopMicrophone]);

  const connect = useCallback(
    (overrides?: string | ConnectOverrides): Promise<boolean> => {
      const normalized: ConnectOverrides =
        typeof overrides === 'string' ? { sessionId: overrides } : overrides ?? {};
      const targetSessionId = normalized.sessionId ?? sessionId;
      const targetCourseId =
        normalized.courseId !== undefined ? normalized.courseId : courseId ?? null;
      const targetModuleId =
        normalized.moduleId !== undefined ? normalized.moduleId : moduleId ?? null;

      if (!targetSessionId) {
        setErrorMessage('Aucune séance sélectionnée.');
        return Promise.resolve(false);
      }

      if (
        !overrides &&
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN
      ) {
        return Promise.resolve(true);
      }

      disconnect();
      setErrorMessage(null);
      setConnectionState('connecting');
      ensureOutputAudioContext().catch(() => {});

      return new Promise((resolve) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const query = new URLSearchParams({
          sessionId: targetSessionId,
          model,
          voice,
        });
        if (targetCourseId) query.set('courseId', targetCourseId);
        if (targetModuleId) query.set('moduleId', targetModuleId);

        const wsUrl = `${protocol}//${window.location.host}/api/live-ws?${query.toString()}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        let settled = false;

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as {
              type: string;
              data?: string;
              text?: string;
              message?: string;
              steps?: BoardStep[];
              pointer?: BoardPointer;
            };

            switch (msg.type) {
              case 'connected':
                setConnectionState('connected');
                appendTranscript('system', `Session Live ouverte (${model} · voix ${voice}).`);
                if (!settled) {
                  settled = true;
                  resolve(true);
                }
                break;
              case 'audio':
                if (msg.data) {
                  playPcm24kChunk(msg.data);
                }
                break;
              case 'interrupted':
                stopAudioPlayback();
                currentTeacherTurnRef.current = '';
                break;
              case 'input_transcript':
                currentTeacherTurnRef.current = '';
                if (msg.text) appendTranscript('student', msg.text);
                break;
              case 'output_transcript':
                if (msg.text) {
                  appendTranscript('teacher', msg.text);
                  const needsSpace =
                    currentTeacherTurnRef.current.length > 0 &&
                    !currentTeacherTurnRef.current.endsWith(' ') &&
                    !msg.text.startsWith(' ') &&
                    !/^[.,!?;:]/.test(msg.text);
                  currentTeacherTurnRef.current = `${currentTeacherTurnRef.current}${
                    needsSpace ? ' ' : ''
                  }${msg.text}`;
                  onTeacherSpeechRef.current?.(msg.text, currentTeacherTurnRef.current);
                }
                break;
              case 'turn_complete':
                currentTeacherTurnRef.current = '';
                break;
              case 'board_updated':
                if (Array.isArray(msg.steps)) {
                  onBoardStepsUpdatedRef.current(msg.steps);
                }
                break;
              case 'pointer_moved':
                if (msg.pointer) {
                  onPointerMovedRef.current?.(msg.pointer);
                }
                break;
              case 'error':
                setErrorMessage(msg.message || 'Erreur de session Live.');
                setConnectionState('error');
                if (!settled) {
                  settled = true;
                  resolve(false);
                }
                break;
              case 'closed':
                stopMicrophone();
                stopAudioPlayback();
                setConnectionState('disconnected');
                break;
            }
          } catch (err) {
            console.error('Error parsing Live WS message:', err);
          }
        };

        ws.onerror = () => {
          setErrorMessage('Connexion WebSocket interrompue avec le serveur Live.');
          setConnectionState('error');
          if (!settled) {
            settled = true;
            resolve(false);
          }
        };

        ws.onclose = () => {
          if (wsRef.current === ws) {
            wsRef.current = null;
            stopMicrophone();
            setConnectionState((prev) => (prev === 'error' ? 'error' : 'disconnected'));
          }
          if (!settled) {
            settled = true;
            resolve(false);
          }
        };
      });
    },
    [
      appendTranscript,
      courseId,
      disconnect,
      ensureOutputAudioContext,
      model,
      moduleId,
      playPcm24kChunk,
      sessionId,
      stopAudioPlayback,
      stopMicrophone,
      voice,
    ],
  );

  const startMicrophone = useCallback(async () => {
    setErrorMessage(null);
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      const ok = await connect();
      if (!ok) return;
    }

    try {
      await ensureOutputAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtxRef.current = inputCtx;
      if (inputCtx.state === 'suspended') {
        await inputCtx.resume();
      }

      const source = inputCtx.createMediaStreamSource(stream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const silentGain = inputCtx.createGain();
      silentGain.gain.value = 0;

      isMicActiveRef.current = true;
      setIsMicActive(true);

      processor.onaudioprocess = (event) => {
        if (!isMicActiveRef.current) return;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const inputData = event.inputBuffer.getChannelData(0);
        let sumSq = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSq += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSq / inputData.length);
        setMicLevel(Math.min(1, rms * 5));

        const base64 = float32ToInt16Base64(inputData, inputCtx.sampleRate, 16000);
        ws.send(JSON.stringify({ type: 'audio', data: base64 }));
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(inputCtx.destination);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Impossible d’accéder au microphone. Vérifiez les autorisations du navigateur.';
      setErrorMessage(msg);
      stopMicrophone();
    }
  }, [connect, ensureOutputAudioContext, stopMicrophone]);

  const toggleMicrophone = useCallback(async () => {
    if (isMicActiveRef.current) {
      stopMicrophone();
    } else {
      await startMicrophone();
    }
  }, [startMicrophone, stopMicrophone]);

  const sendTextPrompt = useCallback(
    async (text: string, connectOverrides?: ConnectOverrides) => {
      const trimmed = text.trim();
      if (!trimmed) return false;

      if (connectOverrides || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        const ok = await connect(connectOverrides);
        if (!ok) return false;
      }

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;

      await ensureOutputAudioContext();
      appendTranscript('student', trimmed);
      ws.send(JSON.stringify({ type: 'text', text: trimmed }));
      return true;
    },
    [appendTranscript, connect, ensureOutputAudioContext],
  );

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
      if (outputCtxRef.current && outputCtxRef.current.state !== 'closed') {
        outputCtxRef.current.close().catch(() => {});
      }
    };
  }, [disconnect]);

  return {
    connectionState,
    isMicActive,
    isTeacherSpeaking,
    micLevel,
    errorMessage,
    transcripts,
    connect,
    disconnect,
    toggleMicrophone,
    sendTextPrompt,
    clearTranscripts,
  };
}
