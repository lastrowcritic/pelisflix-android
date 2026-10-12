import { useCallback, useEffect, useState } from 'react';
import { Download as DownloadIcon } from 'lucide-react';
import { isNative, TV } from '../core/native';
import { findUpdate, type Release } from '../core/update';
import { TVButton } from './TVButton';

export interface AppUpdate {
  version: string; enabled: boolean; release?: Release; status: string; progress?: number; prompt: boolean;
  check(): Promise<void>; install(): Promise<void>; dismiss(): void;
}

const fetchText = async (url: string) => { const reply = await TV.request({ url, method: 'GET', timeout: 15000 }); if (reply.status !== 200) throw new Error(`GitHub answered ${reply.status}.`); return reply.text; };

/** Checks GitHub for a newer release once at launch, and on demand from Settings. */
export function useAppUpdate(): AppUpdate {
  const [info, setInfo] = useState({ version: '', repo: '' }), [release, setRelease] = useState<Release>(), [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number>(), [prompt, setPrompt] = useState(false);
  const check = useCallback(async (manual = true, current = info) => {
    if (!current.version || !current.repo) return;
    if (manual) setStatus('Checking for updates…');
    try {
      const found = await findUpdate(current.version, current.repo, fetchText);
      setRelease(found || undefined);
      if (found && !manual) setPrompt(true);
      if (manual) setStatus(found ? `Version ${found.version} is available.` : 'You have the latest version.');
    } catch { if (manual) setStatus('Updates could not be checked. Try again later.'); }
  }, [info]);
  useEffect(() => {
    if (!isNative) return;
    void TV.appInfo().then(value => { const current = { version: value.version, repo: value.updateRepo }; setInfo(current); void check(false, current); }).catch(() => undefined);
  }, []);
  const install = useCallback(async () => {
    if (!release || progress !== undefined) return;
    const listener = await TV.addListener('updateProgress', value => setProgress(value.progress));
    setProgress(0); setStatus('Downloading the update…');
    try { await TV.installUpdate({ url: release.apk }); setStatus('Confirm the installation on the system screen.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'The update could not be downloaded.'); }
    finally { setProgress(undefined); await listener.remove(); }
  }, [release, progress]);
  return { version: info.version, enabled: !!info.version && !!info.repo, release, status, progress, prompt, check: () => check(true), install, dismiss: () => setPrompt(false) };
}

const progressLabel = (progress: number) => progress < 0 ? 'Downloading…' : `Downloading ${progress}%`;

export function UpdateDialog({ update }: { update: AppUpdate }) {
  if (!update.prompt || !update.release) return null;
  return <div className="modal-backdrop"><section className="modal" data-focus-scope="active" role="dialog" aria-modal="true" aria-labelledby="update-title">
    <p className="eyebrow">Pelisflix {update.version}</p><h2 id="update-title">Version {update.release.version} is available</h2>
    <p>{update.status && update.progress === undefined ? update.status : 'A new version of the app is ready to download. Your history, watchlist and downloads are kept.'}</p>
    <div className="action-row"><TVButton id="update-install" data-focus-default="true" className="primary" disabled={update.progress !== undefined} onClick={() => void update.install()}><DownloadIcon size={20}/>{update.progress !== undefined ? progressLabel(update.progress) : 'Update now'}</TVButton><TVButton id="update-later" onClick={update.dismiss}>Later</TVButton></div>
  </section></div>;
}

export function UpdateSection({ update }: { update: AppUpdate }) {
  if (!update.enabled) return null;
  return <section data-focus-context="true"><h2>App updates</h2><div className="setting-row" data-focus-group="settings-update" data-focus-axis="row"><div><h3>Pelisflix {update.version}</h3><p>{update.progress !== undefined ? progressLabel(update.progress) : update.status || 'New versions are checked when the app starts.'}</p></div>
    {update.release ? <TVButton id="update-install-settings" className="primary" disabled={update.progress !== undefined} onClick={() => void update.install()}><DownloadIcon size={20}/>Install {update.release.version}</TVButton> : <TVButton id="update-check" onClick={() => void update.check()}>Check for updates</TVButton>}
  </div></section>;
}
