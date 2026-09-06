/**
 * Application shell.
 *
 * A fixed five-region grid: rail, side panel, canvas, inspector, top bar. The
 * canvas is the only region that flexes, and each panel scrolls independently so
 * a long layers tree never pushes the canvas around.
 */

import { useCallback, useEffect, useState } from 'react';
import { Canvas } from '../canvas/Canvas';
import { PagesFlow } from './flow/PagesFlow';
import { Inspector } from './inspector/Inspector';
import { InsertPanel } from './panels/InsertPanel';
import { LayersPanel } from './panels/LayersPanel';
import { PagesPanel } from './panels/PagesPanel';
import { CloudPanel } from './panels/CloudPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { ThemePanel } from './panels/ThemePanel';
import { PreviewOverlay } from './PreviewOverlay';
import { Rail } from './Rail';
import { TopBar } from './TopBar';
import { Modal, Toasts } from './common';
import { AuthGate } from './AuthGate';
import { SHORTCUTS, useKeyboard } from '../hooks/useKeyboard';
import { installSaveGuards, useEditor } from '../store/editor';
import { useAccount } from '../store/account';
import { cloudAvailable } from '../cloud/config';

export function App() {
  const session = useAccount((s) => s.session);
  const restoring = useAccount((s) => s.restoring);
  const account = useAccount();

  /*
   * Restore at the shell, not in the cloud panel.
   *
   * It used to run when that panel mounted, which was fine when signing in was
   * optional — nothing before that point cared who you were. With a gate, the
   * whole editor depends on the answer, so it has to be asked on load.
   */
  useEffect(() => {
    void account.restore();
    // Once, on mount; `account` is a stable store handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panel = useEditor((s) => s.leftPanel);
  const view = useEditor((s) => s.view);
  const inspectorOpen = useEditor((s) => s.inspectorOpen);
  const drag = useEditor((s) => s.drag);
  const [help, setHelp] = useState(false);

  const openHelp = useCallback(() => setHelp(true), []);
  useKeyboard(openHelp);

  useEffect(installSaveGuards, []);

  /*
   * The gate, and the two cases it must not fire on.
   *
   * `cloudAvailable()` is false from a `file://` URL and in a build with no
   * project, where there is no API to sign in against — gating there would lock
   * the editor shut with no way through, so it stays local-only instead.
   *
   * `restoring` covers the reload: a signed-in visitor has a cookie but no
   * session object for the moment it takes to ask. Rendering the gate in that
   * gap would flash a sign-in form at someone who is already signed in.
   */
  if (cloudAvailable() && !session) {
    if (restoring) return <div className="gate gate--waiting" />;
    return <AuthGate />;
  }

  return (
    <div
      className="app"
      data-dragging={drag?.active ? 'true' : undefined}
      data-nodrop={drag?.active && !drag.target ? 'true' : undefined}
      data-inspector={inspectorOpen ? 'open' : 'closed'}
      data-view={view}
    >
      <TopBar />
      <Rail onHelp={openHelp} />

      {view === 'design' && panel ? (
        <div className="app__panel">
          {panel === 'insert' ? <InsertPanel /> : null}
          {panel === 'layers' ? <LayersPanel /> : null}
          {panel === 'pages' ? <PagesPanel /> : null}
          {panel === 'cloud' ? <CloudPanel /> : null}
          {panel === 'theme' ? <ThemePanel /> : null}
          {panel === 'settings' ? <SettingsPanel /> : null}
        </div>
      ) : null}

      <main className="app__canvas">
        {view === 'design' ? <Canvas /> : <PagesFlow />}
      </main>

      {view === 'design' ? <Inspector /> : null}

      <PreviewOverlay />
      <Toasts />

      {help ? (
        <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <table className="ui-keys">
            <tbody>
              {SHORTCUTS.map((shortcut) => (
                <tr key={shortcut.keys}>
                  <th scope="row">
                    <kbd>{shortcut.keys}</kbd>
                  </th>
                  <td>{shortcut.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      ) : null}
    </div>
  );
}
