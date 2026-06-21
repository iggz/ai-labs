/**
 * @file BatchExplorer.jsx
 * @description Grid of batch cards for the debug dashboard.
 *
 * Each batch card links to the compare page filtered by that batch.
 * Shows batch number, name, exercise type, status, method pills,
 * and creation date.
 *
 * @param {Object}   props
 * @param {Object[]} props.batches - Array of batch objects
 * @param {number}   props.batches[].batch_number
 * @param {string}   props.batches[].name
 * @param {string}   props.batches[].exercise_type
 * @param {string}   props.batches[].status - e.g. 'complete', 'running', 'failed'
 * @param {string[]} props.batches[].methods - Methods included in this batch
 * @param {string}   props.batches[].created_at - ISO-8601 timestamp
 */
import { Link } from 'react-router-dom';

const METHOD_PILLS = [
  { key: 'dnn',       label: 'DNN',       cls: 'dbg-method-tag--dnn' },
  { key: 'yolo',      label: 'YOLO',      cls: 'dbg-method-tag--yolo' },
  { key: 'on-device', label: 'On-Device', cls: 'dbg-method-tag--on-device' },
];

const STATUS_BADGE = {
  complete: 'dbg-badge--ok',
  running:  'dbg-badge--warn',
  failed:   'dbg-badge--critical',
  pending:  'dbg-badge--cold',
};

/** Format ISO date to a short readable string */
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BatchExplorer({ batches = [] }) {
  return (
    <div className="dbg-card">
      <div className="dbg-card__header">
        <h3 className="dbg-card__title">
          <span className="dbg-card__title-icon">📦</span> Batch Explorer
        </h3>
        <span className="dbg-card__badge">{batches.length} batches</span>
      </div>

      <div className="dbg-card__body">
        {batches.length === 0 ? (
          <div className="dbg-empty">
            <span className="dbg-empty__icon">📦</span>
            <h4 className="dbg-empty__title">No batches yet</h4>
            <p className="dbg-empty__text">
              Create a batch run to compare methods side by side.
            </p>
          </div>
        ) : (
          <div className="dbg-batch-grid">
            {batches.map((batch) => {
              const batchMethods = batch.methods || [];
              const statusCls = STATUS_BADGE[batch.status] || 'dbg-badge--cold';

              return (
                <Link
                  key={batch.batch_number}
                  className="dbg-batch-card"
                  to={`/debug/compare?batch=${batch.batch_number}`}
                >
                  <div className="dbg-batch-card__header">
                    <span className="dbg-batch-card__title">
                      Batch #{batch.batch_number}
                    </span>
                    <span className={`dbg-badge ${statusCls}`}>
                      {batch.status || 'unknown'}
                    </span>
                  </div>

                  {batch.name && (
                    <span className="dbg-batch-card__meta">{batch.name}</span>
                  )}

                  <span className="dbg-batch-card__meta">
                    {batch.exercise_type || 'mixed'} · {formatDate(batch.created_at)}
                  </span>

                  <div className="dbg-batch-card__pills">
                    {METHOD_PILLS.map(({ key, label, cls }) => {
                      const active = batchMethods.includes(key);
                      return (
                        <span
                          key={key}
                          className={`dbg-method-tag ${cls}`}
                          style={{ opacity: active ? 1 : 0.25 }}
                        >
                          {label}
                        </span>
                      );
                    })}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
