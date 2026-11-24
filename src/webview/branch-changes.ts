import { VsCodeEnhancedGitFileIcons } from './theme-file-icons';
import { mountChanges } from './react/changes-app';

mountChanges({ document, window, api: acquireVsCodeApi(), fileIcons: VsCodeEnhancedGitFileIcons });
