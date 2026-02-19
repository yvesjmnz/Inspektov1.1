import React from 'react';
import './Stepper.css';

function Stepper({ steps = [], currentStep = 1 }) {
  const total = steps.length;
  const safeCurrent = Math.min(Math.max(1, currentStep), total || 1);

  return (
    <nav className="stepper" aria-label={`Form steps (${safeCurrent} of ${total})`}>
      <div className="stepper-trail" role="list">
        {steps.map((title, idx) => {
          const stepNumber = idx + 1;
          const status = stepNumber < safeCurrent ? 'completed' : stepNumber === safeCurrent ? 'active' : 'upcoming';
          const connectorStatus = stepNumber < safeCurrent ? 'completed' : 'upcoming';

          return (
            <div className="stepper-segment" role="listitem" key={`${title}-${idx}`} aria-current={status === 'active' ? 'step' : undefined}>
              <div className={`stepper-node ${status}`}>
                <span className="step-index">{stepNumber}</span>
              </div>
              <div className={`stepper-title ${status}`}>{title}</div>
              {idx < steps.length - 1 ? (
                <div className={`stepper-connector ${connectorStatus}`} aria-hidden="true" />
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export default Stepper;
