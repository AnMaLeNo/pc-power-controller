import {
  AppShell,
  ConfirmationModal,
  EventLog,
  Hero,
  LoadingSpinner,
  MetaFooter,
  Panel,
  PanelGrid,
  StatusPill,
  StatusReadout,
  ThemeToggle,
  TopBar,
  postCommand,
  timeFormatter,
  useCommand,
  useDeviceStream,
  useTheme
} from 'aruids';
import type { EventLogEntry, StatusTone } from 'aruids';
import { Power, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

type PowerAction = 'SHORT_PRESS' | 'LONG_PRESS';

type ApiSuccess = {
  status: string;
  message: string;
  topic: string;
  timestamp: string;
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

// Transforme l'événement ESP en libellé lisible pour le journal.
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

export default function App() {
  const { theme, toggleTheme } = useTheme('pc-power-theme');
  const [confirmLongPress, setConfirmLongPress] = useState(false);

  const command = useCommand((action: PowerAction) =>
    postCommand<ApiSuccess>('/api/power', { action })
  );

  // Flux SSE : retours réels de l'ESP relayés par l'API (topic bureau/pc/power/log)
  const stream = useDeviceStream<EspEvent>({
    url: '/api/events',
    describeEvent: describeEspEvent
  });

  const runCommand = async (action: PowerAction) => {
    await command.run(action);
    setConfirmLongPress(false);
  };

  const isBusy = command.isBusy;

  const controllerStatusLabel =
    stream.isDeviceOnline === null
      ? 'État du contrôleur inconnu'
      : stream.isDeviceOnline
        ? 'Contrôleur en ligne'
        : 'Contrôleur hors ligne';

  const status = useMemo((): { tone: StatusTone; label: string; detail: string } => {
    if (command.requestState === 'pending' && command.pendingInput) {
      return {
        tone: 'pending',
        label: 'Transmission…',
        detail: `${actionLabels[command.pendingInput]} · ${actionDurations[command.pendingInput]}`
      };
    }
    if (command.requestState === 'success' && command.lastResult) {
      return {
        tone: 'success',
        label: 'Commande envoyée',
        detail: `${actionLabels[command.lastResult.input]} · ${timeFormatter.format(command.lastResult.timestamp)}`
      };
    }
    if (command.requestState === 'error' && command.lastResult) {
      return {
        tone: 'error',
        label: 'Échec de la commande',
        detail: command.lastResult.message
      };
    }
    return {
      tone: 'idle',
      label: 'Prêt',
      detail: `Appui court · ${actionDurations.SHORT_PRESS}`
    };
  }, [command.requestState, command.pendingInput, command.lastResult]);

  const commandEntries = useMemo(
    (): EventLogEntry[] =>
      command.logs.map((entry) => ({
        id: entry.id,
        label: actionLabels[entry.input],
        detail: entry.message,
        tone: entry.status,
        timestamp: entry.timestamp
      })),
    [command.logs]
  );

  const deviceEntries = useMemo(
    (): EventLogEntry[] =>
      stream.events.map((event) => ({
        id: event.id,
        label: event.label,
        tone: event.isError ? 'error' : 'success',
        timestamp: event.timestamp
      })),
    [stream.events]
  );

  return (
    <AppShell>
      <TopBar icon={<Power />} title="PC Power Controller" subtitle="Bureau">
        <StatusPill
          state={stream.isDeviceOnline === null ? 'unknown' : stream.isDeviceOnline ? 'online' : 'offline'}
          label="Contrôleur"
          description={controllerStatusLabel}
        />
        <StatusPill
          state={stream.isStreamConnected ? 'online' : 'offline'}
          label={stream.isStreamConnected ? 'Temps réel' : 'Hors ligne'}
          description={
            stream.isStreamConnected ? 'Flux temps réel connecté' : 'Flux temps réel hors ligne'
          }
        />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </TopBar>

      <main className="content">
        <Hero label="Commandes d'alimentation">
          <button
            type="button"
            className="power-button"
            disabled={isBusy}
            onClick={() => void runCommand('SHORT_PRESS')}
            aria-label={`Allumer — appui court (${actionDurations.SHORT_PRESS})`}
          >
            {command.pendingInput === 'SHORT_PRESS' ? (
              <LoadingSpinner />
            ) : (
              <Power aria-hidden="true" />
            )}
          </button>

          <StatusReadout tone={status.tone} label={status.label} detail={status.detail} />

          <button
            type="button"
            className="force-button"
            disabled={isBusy}
            onClick={() => setConfirmLongPress(true)}
          >
            Forcer l'arrêt
            <span className="force-tag">{actionDurations.LONG_PRESS}</span>
          </button>
        </Hero>

        <PanelGrid>
          <Panel
            title="Journal local"
            headerExtra={
              command.logs.length > 0
                ? `${command.logs.length} entrée${command.logs.length > 1 ? 's' : ''}`
                : undefined
            }
          >
            <EventLog entries={commandEntries} emptyLabel="Aucune commande envoyée" />
          </Panel>

          <Panel
            title="Retours du PC"
            headerExtra={
              stream.events.length > 0
                ? `${stream.events.length} événement${stream.events.length > 1 ? 's' : ''}`
                : undefined
            }
          >
            <EventLog entries={deviceEntries} emptyLabel="En attente du contrôleur" />
          </Panel>
        </PanelGrid>
      </main>

      <MetaFooter label="MQTT" code="bureau/pc/power/set" />

      <ConfirmationModal
        isOpen={confirmLongPress}
        icon={<ShieldAlert />}
        title="Forcer l'arrêt ?"
        confirmLabel="Forcer l'arrêt"
        onCancel={() => setConfirmLongPress(false)}
        onConfirm={() => void runCommand('LONG_PRESS')}
        isBusy={command.pendingInput === 'LONG_PRESS'}
      >
        Cette commande simule un appui de 6 secondes sur le bouton d'alimentation. Le système sera
        éteint sans arrêt propre.
      </ConfirmationModal>
    </AppShell>
  );
}
