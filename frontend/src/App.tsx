import { LoaderCircle, Moon, Power, ShieldAlert, Sun } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

type PowerAction = 'SHORT_PRESS' | 'LONG_PRESS';
type RequestState = 'idle' | 'pending' | 'success' | 'error';
type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'pc-power-theme';
const themeColors: Record<Theme, string> = {
  dark: '#0a0a0c',
  light: '#f7f7f8'
};

// Le script inline d'index.html applique le thème avant le premier rendu
// (anti-flash) ; on relit l'attribut pour démarrer React synchronisé.
function getInitialTheme(): Theme {
  const applied = document.documentElement.dataset.theme;
  if (applied === 'light' || applied === 'dark') return applied;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

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

type DeviceEvent = {
  id: string;
  kind: 'pulse_start' | 'pulse_end' | 'error' | 'raw';
  label: string;
  isError: boolean;
  timestamp: Date;
};

const actionLabels: Record<PowerAction, string> = {
  SHORT_PRESS: 'Appui court',
  LONG_PRESS: 'Appui long'
};

const actionDurations: Record<PowerAction, string> = {
  SHORT_PRESS: '300 ms',
  LONG_PRESS: '6 s'
};

// Événement structuré reçu de l'ESP (relayé tel quel par l'API via SSE).
// `status` est produit par l'API depuis le topic de présence (naissance/LWT).
type EspEvent = {
  event: 'pulse_start' | 'pulse_end' | 'error' | 'raw' | 'status';
  action?: PowerAction;
  reason?: string;
  message?: string;
  online?: boolean;
  timestamp: string;
};

const errorReasons: Record<string, string> = {
  pulse_already_active: 'Impulsion déjà en cours',
  unknown_command: 'Commande inconnue',
  payload_too_large: 'Message trop volumineux'
};

// Transforme l'événement ESP en libellé lisible pour l'UI.
function describeEspEvent(data: EspEvent): { label: string; isError: boolean } {
  const actionLabel = data.action ? actionLabels[data.action] : null;
  switch (data.event) {
    case 'pulse_start':
      return { label: actionLabel ? `Impulsion démarrée — ${actionLabel}` : 'Impulsion démarrée', isError: false };
    case 'pulse_end':
      return { label: actionLabel ? `Impulsion terminée — ${actionLabel}` : 'Impulsion terminée', isError: false };
    case 'error':
      return { label: errorReasons[data.reason ?? ''] ?? `Erreur : ${data.reason ?? 'inconnue'}`, isError: true };
    default:
      return { label: data.message ?? 'Événement', isError: false };
  }
}

// Identifiants des entrées de journaux (clés React). crypto.randomUUID()
// n'est disponible qu'en contexte sécurisé (HTTPS ou localhost) : servie en
// HTTP sur le LAN, la fonction n'existe pas et ferait planter l'application.
// Un compteur horodaté suffit ici (unicité par session seulement).
let eventIdCounter = 0;
function nextEventId(): string {
  eventIdCounter += 1;
  return `${Date.now().toString(36)}-${eventIdCounter}`;
}

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
  const [deviceEvents, setDeviceEvents] = useState<DeviceEvent[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  // Présence du contrôleur (LWT MQTT relayé par l'API) ; null tant qu'aucun
  // état retenu n'est arrivé (ESP jamais vu par le broker).
  const [deviceOnline, setDeviceOnline] = useState<boolean | null>(null);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', themeColors[theme]);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // stockage indisponible (navigation privée) : le choix vaut pour la session
    }
  }, [theme]);

  // Flux SSE : retours réels de l'ESP relayés par l'API (topic bureau/pc/power/log)
  useEffect(() => {
    const source = new EventSource('/api/events');

    source.onopen = () => setStreamConnected(true);

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as EspEvent;
        if (data.event === 'status') {
          setDeviceOnline(data.online === true);
          return;
        }
        const { label, isError } = describeEspEvent(data);
        // Calculé hors de la closure : le rétrécissement de type du `return`
        // ci-dessus ne survit pas à l'intérieur du callback de setState.
        const kind: DeviceEvent['kind'] =
          data.event === 'pulse_start' || data.event === 'pulse_end' || data.event === 'error'
            ? data.event
            : 'raw';
        setDeviceEvents((current) =>
          [
            {
              id: nextEventId(),
              kind,
              label,
              isError,
              timestamp: data.timestamp ? new Date(data.timestamp) : new Date()
            },
            ...current
          ].slice(0, 12)
        );
      } catch {
        // payload non-JSON ignoré
      }
    };

    source.onerror = () => setStreamConnected(false);

    return () => source.close();
  }, []);

  // Modale : focus initial sur « Annuler » et fermeture via Échap.
  useEffect(() => {
    if (!confirmLongPress) return;
    cancelButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmLongPress(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmLongPress]);

  const runCommand = async (action: PowerAction) => {
    setRequestState('pending');
    setPendingAction(action);

    try {
      const result = await sendPowerCommand(action);
      const entry: CommandLog = {
        id: nextEventId(),
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
        id: nextEventId(),
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

  const controllerStatusLabel =
    deviceOnline === null
      ? 'État du contrôleur inconnu'
      : deviceOnline
        ? 'Contrôleur en ligne'
        : 'Contrôleur hors ligne';

  const status = useMemo(() => {
    if (requestState === 'pending' && pendingAction) {
      return {
        tone: 'pending',
        label: 'Transmission…',
        detail: `${actionLabels[pendingAction]} · ${actionDurations[pendingAction]}`
      };
    }
    if (requestState === 'success' && lastResult) {
      return {
        tone: 'success',
        label: 'Commande envoyée',
        detail: `${actionLabels[lastResult.action]} · ${timeFormatter.format(lastResult.timestamp)}`
      };
    }
    if (requestState === 'error' && lastResult) {
      return {
        tone: 'error',
        label: 'Échec de la commande',
        detail: lastResult.message
      };
    }
    return {
      tone: 'idle',
      label: 'Prêt',
      detail: `Appui court · ${actionDurations.SHORT_PRESS}`
    };
  }, [requestState, pendingAction, lastResult]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Power />
          </span>
          <div className="brand-text">
            <h1>PC Power Controller</h1>
            <span>Bureau</span>
          </div>
        </div>
        <div className="topbar-actions">
          <span
            className={`link-status ${deviceOnline === null ? '' : deviceOnline ? 'online' : 'offline'}`}
            role="status"
            aria-label={controllerStatusLabel}
            title={controllerStatusLabel}
          >
            <span className="link-dot" aria-hidden="true" />
            <span className="link-label">Contrôleur</span>
          </span>
          <span
            className={`link-status ${streamConnected ? 'online' : 'offline'}`}
            role="status"
            aria-label={streamConnected ? 'Flux temps réel connecté' : 'Flux temps réel hors ligne'}
            title={streamConnected ? 'Flux temps réel connecté' : 'Flux temps réel hors ligne'}
          >
            <span className="link-dot" aria-hidden="true" />
            <span className="link-label">{streamConnected ? 'Temps réel' : 'Hors ligne'}</span>
          </span>
          <button
            type="button"
            className="theme-button"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          >
            {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main className="content">
        <section className="hero" aria-label="Commandes d'alimentation">
          <button
            type="button"
            className="power-button"
            disabled={isBusy}
            onClick={() => void runCommand('SHORT_PRESS')}
            aria-label={`Allumer — appui court (${actionDurations.SHORT_PRESS})`}
          >
            {pendingAction === 'SHORT_PRESS' ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <Power aria-hidden="true" />
            )}
          </button>

          <div className="status" role="status" aria-live="polite">
            <p className={`status-label ${status.tone}`}>{status.label}</p>
            <p className="status-detail">{status.detail}</p>
          </div>

          <button
            type="button"
            className="force-button"
            disabled={isBusy}
            onClick={() => setConfirmLongPress(true)}
          >
            Forcer l'arrêt
            <span className="force-tag">{actionDurations.LONG_PRESS}</span>
          </button>
        </section>

        <div className="panels">
          <section className="panel" aria-labelledby="logs-title">
            <header className="panel-heading">
              <h2 id="logs-title">Journal local</h2>
              {logs.length > 0 && (
                <span>
                  {logs.length} entrée{logs.length > 1 ? 's' : ''}
                </span>
              )}
            </header>
            {logs.length === 0 ? (
              <p className="empty">Aucune commande envoyée</p>
            ) : (
              <ol className="rows">
                {logs.map((entry) => (
                  <li key={entry.id}>
                    <span className={`row-dot ${entry.status}`} aria-hidden="true" />
                    <div className="row-body">
                      <div className="row-line">
                        <strong>{actionLabels[entry.action]}</strong>
                        <time>{timeFormatter.format(entry.timestamp)}</time>
                      </div>
                      <small title={entry.message}>{entry.message}</small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="panel" aria-labelledby="device-title">
            <header className="panel-heading">
              <h2 id="device-title">Retours du PC</h2>
              {deviceEvents.length > 0 && (
                <span>
                  {deviceEvents.length} événement{deviceEvents.length > 1 ? 's' : ''}
                </span>
              )}
            </header>
            {deviceEvents.length === 0 ? (
              <p className="empty">En attente du contrôleur</p>
            ) : (
              <ol className="rows">
                {deviceEvents.map((event) => (
                  <li key={event.id}>
                    <span className={`row-dot ${event.isError ? 'error' : 'success'}`} aria-hidden="true" />
                    <div className="row-body">
                      <div className="row-line">
                        <strong>{event.label}</strong>
                        <time>{timeFormatter.format(event.timestamp)}</time>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </main>

      <footer className="meta">
        <span>MQTT</span>
        <code>bureau/pc/power/set</code>
      </footer>

      {confirmLongPress && (
        <div className="backdrop" role="presentation" onMouseDown={() => setConfirmLongPress(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-body"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="dialog-icon" aria-hidden="true">
              <ShieldAlert />
            </span>
            <h2 id="confirm-title">Forcer l'arrêt ?</h2>
            <p id="confirm-body">
              Cette commande simule un appui de 6 secondes sur le bouton d'alimentation. Le système
              sera éteint sans arrêt propre.
            </p>
            <div className="dialog-actions">
              <button
                ref={cancelButtonRef}
                type="button"
                className="button-ghost"
                onClick={() => setConfirmLongPress(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="button-danger"
                disabled={isBusy}
                onClick={() => void runCommand('LONG_PRESS')}
              >
                {pendingAction === 'LONG_PRESS' ? (
                  <LoaderCircle className="spin" aria-hidden="true" />
                ) : null}
                Forcer l'arrêt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
