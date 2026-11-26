/// <reference types="vite/client" />
// SPDX-License-Identifier: MIT
import {
  createFeatureGate,
  defineFeatures,
  resolveFeatureChannel,
  type FeatureChannel,
  type FeatureDefinition,
} from '@tano/protocol/features';

export { createFeatureGate, defineFeatures, resolveFeatureChannel };
export type { FeatureChannel, FeatureDefinition };

export const features = defineFeatures({
  assistantClipboardAttachments: { status: 'dev', note: 'Paste local files and images into the assistant composer.' },
  codeFileEditing: { status: 'dev', note: 'In-place CodeMirror editing with three-way merge for plain-text and source code files.' },
  desktopMailClient: { status: 'dev', note: 'Desktop native IMAP/SMTP mail client with calendar and document integration.' },
  markdownSpacingAutocomplete: { status: 'dev', note: 'Insert real Markdown spaces at mixed-script boundaries while editing.' },
  sshRemoteWorkspace: { status: 'dev', note: 'Connect to remote SSH servers to browse, preview, and edit workspaces.' },
});
// Optional env keeps the pure API usable in Node as well as Vite consumers.
export const featureChannel = resolveFeatureChannel(import.meta.env ?? {});
export const isFeatureEnabled = createFeatureGate(features, featureChannel).isEnabled;
