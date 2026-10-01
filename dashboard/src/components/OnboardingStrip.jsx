import React from 'react';

export default function OnboardingStrip({ runningServices, totalServices, demoMode, onCreateSession, onDismiss }) {
  return (
    <div className="onboarding-strip">
      <div className="onboarding-copy">
        <strong>Welcome to motor-pool.</strong>
        <span>
          Choose an experience, pick a model, then click <strong>+ New ▾</strong> to create a session.
          {totalServices > 0 && ` ${runningServices}/${totalServices} services are live.`}
          {demoMode.enabled && ' Demo mode is locked to Safe Chat and the primary model endpoint.'}
        </span>
      </div>
      <div className="onboarding-actions">
        <button className="btn-primary" onClick={onCreateSession}>Create Session</button>
        <button className="btn-secondary" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
