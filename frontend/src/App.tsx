import {
  Activity,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  Power,
  ServerCog,
  ShieldAlert,
  Wifi
} from 'lucide-react';
import { useMemo, useState } from 'react';

type PowerAction = 'SHORT_PRESS' | 'LONG_PRESS';
type RequestState = 'idle' | 'pending' | 'success' | 'error';

type ApiSuccess = {
  status: string;
  message: string;
  topic: string;
  timestamp: string;
};

type CommandLog = {
  id: string;
  action: PowerAction;
  status: Exclude<RequestState, 'idle' | 'pending'>;
  message: string;
  timestamp: Date;
};

const actionLabels: Record<PowerAction, string> = {
  SHORT_PRESS: 'Appui court',
  LONG_PRESS: 'Appui long'
};

const actionDescriptions: Record<PowerAction, string> = {
  SHORT_PRESS: '300 ms',
  LONG_PRESS: '6 s'
};

const timeFormatter = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

async function sendPowerCommand(action: PowerAction): Promise<ApiSuccess> {
  const response = await fetch('/api/power', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action })
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage =
      payload && typeof payload.error === 'string'
        ? payload.error
        : `Erreur HTTP ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as ApiSuccess;
}

export default function App() {
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [pendingAction, setPendingAction] = useState<PowerAction | null>(null);
  const [lastResult, setLastResult] = useState<CommandLog | null>(null);
  const [logs, setLogs] = useState<CommandLog[]>([]);
  const [confirmLongPress, setConfirmLongPress] = useState(false);

  const statusTone = useMemo(() => {
    if (requestState === 'success') return 'success';
    if (requestState === 'error') return 'error';
    if (requestState === 'pending') return 'pending';
    return 'idle';
  }, [requestState]);

  const runCommand = async (action: PowerAction) => {
    setRequestState('pending');
    setPendingAction(action);

    try {
      const result = await sendPowerCommand(action);
      const entry: CommandLog = {
        id: crypto.randomUUID(),
        action,
        status: 'success',
        message: result.message,
        timestamp: new Date(result.timestamp)
      };

      setLastResult(entry);
      setLogs((currentLogs) => [entry, ...currentLogs].slice(0, 8));
      setRequestState('success');
    } catch (error) {
      const entry: CommandLog = {
        id: crypto.randomUUID(),
        action,
        status: 'error',
        message: error instanceof Error ? error.message : 'Commande non transmise',
        timestamp: new Date()
      };

      setLastResult(entry);
      setLogs((currentLogs) => [entry, ...currentLogs].slice(0, 8));
      setRequestState('error');
    } finally {
      setPendingAction(null);
      setConfirmLongPress(false);
    }
  };

  const isBusy = requestState === 'pending';

  return (
    <main className="app-shell">
      <section className="control-panel" aria-labelledby="page-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Bureau</p>
            <h1 id="page-title">PC Power Controller</h1>
          </div>
          <div className={`status-pill ${statusTone}`}>
            {requestState === 'pending' && <LoaderCircle className="spin" aria-hidden="true" />}
            {requestState === 'success' && <CheckCircle2 aria-hidden="true" />}
            {requestState === 'error' && <CircleAlert aria-hidden="true" />}
            {requestState === 'idle' && <Wifi aria-hidden="true" />}
            <span>
              {requestState === 'pending'
                ? 'Transmission'
                : requestState === 'success'
                  ? 'Envoyé'
                  : requestState === 'error'
                    ? 'Erreur'
                    : 'Prêt'}
            </span>
          </div>
        </div>

        <div className="command-grid" aria-label="Commandes alimentation">
          <button
            className="command-button primary"
            type="button"
            disabled={isBusy}
            onClick={() => void runCommand('SHORT_PRESS')}
          >
            <Power aria-hidden="true" />
            <span>
              <strong>Allumer</strong>
              <small>{actionDescriptions.SHORT_PRESS}</small>
            </span>
          </button>

          <button
            className="command-button danger"
            type="button"
            disabled={isBusy}
            onClick={() => setConfirmLongPress(true)}
          >
            <ShieldAlert aria-hidden="true" />
            <span>
              <strong>Forcer l'arrêt</strong>
              <small>{actionDescriptions.LONG_PRESS}</small>
            </span>
          </button>
        </div>

        <div className="summary-grid">
          <article className="metric">
            <ServerCog aria-hidden="true" />
            <span>Topic commande</span>
            <strong>bureau/pc/power/set</strong>
          </article>
          <article className="metric">
            <Activity aria-hidden="true" />
            <span>Dernière action</span>
            <strong>{lastResult ? actionLabels[lastResult.action] : 'Aucune'}</strong>
          </article>
          <article className="metric">
            <Clock3 aria-hidden="true" />
            <span>Horodatage</span>
            <strong>{lastResult ? timeFormatter.format(lastResult.timestamp) : '--:--:--'}</strong>
          </article>
        </div>

        {lastResult && (
          <div className={`result-line ${lastResult.status}`} role="status">
            {lastResult.status === 'success' ? (
              <CheckCircle2 aria-hidden="true" />
            ) : (
              <CircleAlert aria-hidden="true" />
            )}
            <span>{lastResult.message}</span>
          </div>
        )}
      </section>

      <section className="activity-panel" aria-labelledby="activity-title">
        <div className="activity-heading">
          <h2 id="activity-title">Journal local</h2>
          <span>{logs.length} entrée{logs.length > 1 ? 's' : ''}</span>
        </div>

        {logs.length === 0 ? (
          <div className="empty-state">
            <Activity aria-hidden="true" />
            <span>Aucune commande envoyée</span>
          </div>
        ) : (
          <ol className="log-list">
            {logs.map((entry) => (
              <li key={entry.id} className={entry.status}>
                <span className="log-icon">
                  {entry.status === 'success' ? (
                    <CheckCircle2 aria-hidden="true" />
                  ) : (
                    <CircleAlert aria-hidden="true" />
                  )}
                </span>
                <span className="log-body">
                  <strong>{actionLabels[entry.action]}</strong>
                  <small>{entry.message}</small>
                </span>
                <time>{timeFormatter.format(entry.timestamp)}</time>
              </li>
            ))}
          </ol>
        )}
      </section>

      {confirmLongPress && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmLongPress(false)}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <ShieldAlert aria-hidden="true" />
            <h2 id="confirm-title">Confirmer l'appui long</h2>
            <p>La commande sera transmise comme une pression physique de 6 secondes.</p>
            <div className="dialog-actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmLongPress(false)}>
                Annuler
              </button>
              <button
                type="button"
                className="confirm-button"
                disabled={isBusy}
                onClick={() => void runCommand('LONG_PRESS')}
              >
                {pendingAction === 'LONG_PRESS' ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
