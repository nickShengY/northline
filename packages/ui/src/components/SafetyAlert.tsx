import React from 'react';
import { clsx } from 'clsx';
import { Button } from './Button';

export type SafetyAlertType = 'mob' | 'stop-work' | 'hazard' | 'weather' | 'equipment';

export interface SafetyAlertProps {
  type: SafetyAlertType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message?: string;
  location?: string;
  timestamp?: Date;
  acknowledged?: boolean;
  onAcknowledge?: () => void;
  onRespond?: () => void;
  onDismiss?: () => void;
  children?: React.ReactNode;
}

const typeConfig: Record<SafetyAlertType, { icon: React.ReactNode; label: string }> = {
  mob: {
    label: 'MAN OVERBOARD',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14v-2m0 0l-2-2m2 2l2-2" />
      </svg>
    ),
  },
  'stop-work': {
    label: 'STOP WORK',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
  },
  hazard: {
    label: 'HAZARD',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  weather: {
    label: 'WEATHER ALERT',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
      </svg>
    ),
  },
  equipment: {
    label: 'EQUIPMENT',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
};

const severityConfig: Record<string, { color: string; bgColor: string; borderColor: string }> = {
  low: { color: 'var(--info)', bgColor: 'rgba(0, 212, 255, 0.1)', borderColor: 'rgba(0, 212, 255, 0.3)' },
  medium: { color: 'var(--warning)', bgColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)' },
  high: { color: 'var(--danger)', bgColor: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)' },
  critical: { color: '#ff0000', bgColor: 'rgba(255, 0, 0, 0.2)', borderColor: 'rgba(255, 0, 0, 0.6)' },
};

const defaultTypeConfig = { icon: null, label: 'Alert' };
const defaultSeverityConfig = { color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.2)', borderColor: 'rgba(245, 158, 11, 0.6)' };

export const SafetyAlert: React.FC<SafetyAlertProps> = ({
  type,
  severity,
  title,
  message,
  location,
  timestamp,
  acknowledged = false,
  onAcknowledge,
  onRespond,
  onDismiss,
  children,
}) => {
  const typeConf = typeConfig[type] ?? defaultTypeConfig;
  const sevConf = severityConfig[severity] ?? defaultSeverityConfig;
  const isCritical = severity === 'critical';

  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-[var(--radius-xl)] border-2 backdrop-blur-sm',
        'transition-all duration-[var(--transition-base)]',
        isCritical && 'animate-pulse-critical'
      )}
      style={{
        backgroundColor: sevConf.bgColor,
        borderColor: sevConf.borderColor,
      }}
    >
      {/* Critical glow effect */}
      {isCritical && (
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background: `radial-gradient(circle at center, ${sevConf.color}, transparent 70%)`,
          }}
        />
      )}

      <div className="relative p-5">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div
            className="flex items-center justify-center w-14 h-14 rounded-[var(--radius-lg)]"
            style={{ backgroundColor: `${sevConf.color}20` }}
          >
            <span style={{ color: sevConf.color }}>{typeConf.icon}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-bold tracking-wider uppercase"
                style={{ color: sevConf.color }}
              >
                {typeConf.label}
              </span>
              {acknowledged && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--success)]/20 text-[var(--success)]">
                  ACKNOWLEDGED
                </span>
              )}
            </div>
            <h3 className="mt-1 text-lg font-semibold text-[var(--ink-primary)]">
              {title}
            </h3>
          </div>

          {severity === 'critical' && (
            <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-red-500/20 text-red-400 text-sm font-bold animate-pulse">
              CRITICAL
            </div>
          )}
        </div>

        {/* Message */}
        {message && (
          <p className="mt-3 text-[var(--ink-secondary)]">{message}</p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-4 mt-4 text-sm text-[var(--ink-muted)]">
          {location && (
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {location}
            </span>
          )}
          {timestamp && (
            <span className="flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatTime(timestamp)}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-5">
          {onRespond && (
            <Button
              variant="primary"
              onClick={onRespond}
              className="flex-1"
            >
              Respond Now
            </Button>
          )}
          {onAcknowledge && !acknowledged && (
            <Button variant="secondary" onClick={onAcknowledge}>
              Acknowledge
            </Button>
          )}
          {onDismiss && acknowledged && (
            <Button variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
          {children}
        </div>
      </div>
    </div>
  );
};

// MOB Alert - specialized for Man Overboard
export interface MOBAlertProps {
  vesselName?: string;
  coordinates?: { lat: number; lng: number };
  timeInWater?: number; // seconds
  onDeployMarker?: () => void;
  onAlertCrew?: () => void;
  onCallEmergency?: () => void;
}

export const MOBAlert: React.FC<MOBAlertProps> = ({
  coordinates,
  timeInWater = 0,
  onDeployMarker,
  onAlertCrew,
  onCallEmergency,
}) => {
  return (
    <SafetyAlert
      type="mob"
      severity="critical"
      title="MAN OVERBOARD DETECTED"
      message={`Person in water for ${formatDuration(timeInWater)}`}
      location={coordinates ? `${coordinates.lat.toFixed(4)}°N, ${coordinates.lng.toFixed(4)}°W` : undefined}
      onRespond={onCallEmergency}
    >
      <div className="flex gap-2 mt-4">
        {onDeployMarker && (
          <Button variant="danger" onClick={onDeployMarker}>
            Deploy Marker
          </Button>
        )}
        {onAlertCrew && (
          <Button variant="secondary" onClick={onAlertCrew}>
            Alert Crew
          </Button>
        )}
      </div>
    </SafetyAlert>
  );
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs} seconds`;
  return `${mins}m ${secs}s`;
}

export default SafetyAlert;
