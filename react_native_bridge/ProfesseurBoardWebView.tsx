/**
 * Composant prêt à copier dans votre projet Expo / React Native (`frontend/src/components/`).
 * Dépendance mobile requise dans votre projet Expo : `react-native-webview`.
 */
import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export interface ProfesseurBoardWebViewProps {
  serverUrl: string;
  courseId?: string;
  moduleId?: string;
  autoExplain?: boolean;
  onBoardEvent?: (event: {
    type: string;
    steps?: unknown[];
    pointer?: { step_number: number; line_number: number };
    [key: string]: unknown;
  }) => void;
}

export function ProfesseurBoardWebView({
  serverUrl,
  courseId,
  moduleId,
  autoExplain = true,
  onBoardEvent,
}: ProfesseurBoardWebViewProps) {
  const webViewRef = useRef<WebView>(null);

  const cleanBase = serverUrl.replace(/\/+$/, '');
  const query = new URLSearchParams({ embed: '1' });
  if (courseId) query.set('courseId', courseId);
  if (moduleId) query.set('moduleId', moduleId);
  if (autoExplain) query.set('autoExplain', '1');

  const boardUri = `${cleanBase}/?${query.toString()}`;

  const sendCommand = (command: Record<string, unknown>) => {
    const serialized = JSON.stringify(command);
    webViewRef.current?.injectJavaScript(
      `window.postMessage(${JSON.stringify(serialized)}, '*'); true;`,
    );
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const parsed = JSON.parse(event.nativeEvent.data);
      onBoardEvent?.(parsed);
    } catch {
      // Ignore non-JSON messages
    }
  };

  // Expose helper usage example: sendCommand({ type: 'ASK_PROFESSOR', text: 'Donne un exemple' })
  void sendCommand;

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: boardUri }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        onMessage={handleMessage}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F3EC' },
  webview: { flex: 1 },
});
