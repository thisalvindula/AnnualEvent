// Vertical list of workflow steps. Each step: { key, title, state, summary }
// where state is 'done' | 'current' | 'optional' | 'todo' | 'locked'.
// Locked steps can't be opened; their summary says why.
export function StepList({ steps, selected, onSelect }) {
  return (
    <ol className="step-list">
      {steps.map((step, i) => {
        const locked = step.state === 'locked';
        return (
          <li
            key={step.key}
            className={`step-item${selected === step.key ? ' selected' : ''}`}
            data-state={step.state}
          >
            <button
              type="button"
              className="btn-reset step-btn"
              disabled={locked}
              aria-current={selected === step.key ? 'step' : undefined}
              onClick={() => onSelect(step.key)}
            >
              <span className="step-badge">{step.state === 'done' ? '✓' : i + 1}</span>
              <span className="step-text">
                <span className="step-title">{step.title}</span>
                <span className="step-sub">{step.summary}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
