import { SCORE_SCALE, WEIGHT, type ScoreRule, type ScoreSettings, type WeightLevel } from '../score'
import { SCORE_TABLES } from '../scoreRules'

interface ScoreWeightsEditorProps {
  settings: ScoreSettings
  onChange: (settings: ScoreSettings) => void
}

const LEVELS = Object.keys(WEIGHT) as WeightLevel[]
const EDITABLE_LEVELS = LEVELS.filter((level) => level !== 'none') // none is always 0

// Names of tiers and limits most rules share; a rule's own `labels` win
const COMMON_LABELS: Record<string, string> = {
  base: 'Weight',
  big: 'Gap over the limit',
  gap: 'Limit',
  bigGap: 'Full edge at gap',
  bigShare: 'Full edge at difference (0.2 = 20%)',
}
const nameOf = (rule: ScoreRule, key: string): string => rule.labels?.[key] ?? COMMON_LABELS[key] ?? key

/** A number input that applies its value when it loses focus (or on Enter); an empty or bad value is ignored. */
function NumberField(props: { label: string; fullLabel?: string; value: number; onCommit: (value: number) => void }) {
  const { label, fullLabel = label, value, onCommit } = props
  const commit = (text: string) => {
    const next = Number(text)
    if (text.trim() !== '' && Number.isFinite(next) && next !== value) onCommit(next)
  }
  return (
    <label className="score-field">
      {label}
      <input
        key={value} // a new value from outside (reset) replaces what was typed
        type="number"
        step="any"
        defaultValue={value}
        aria-label={fullLabel}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
      />
    </label>
  )
}

/**
 * Weights editor of the team score: one line per row of the tables the score reads, in table order, so a new table
 * row shows up here by itself (rows without a rule show as "Not scored"); plus the points per weight word and the
 * confidence knob. Every change applies at once.
 */
function ScoreWeightsEditor({ settings, onChange }: ScoreWeightsEditorProps) {
  const points = { ...WEIGHT, ...settings.points }
  const override = (rule: ScoreRule) => settings.rules?.[rule.key] ?? {}
  const setRule = (rule: ScoreRule, next: NonNullable<ScoreSettings['rules']>[string] | null) => {
    const rules = { ...settings.rules }
    if (next) rules[rule.key] = next
    else delete rules[rule.key]
    const updated: ScoreSettings = { ...settings, rules }
    if (!Object.keys(rules).length) delete updated.rules
    onChange(updated)
  }
  const setLevel = (rule: ScoreRule, tier: string, level: WeightLevel) =>
    setRule(rule, { ...override(rule), levels: { ...override(rule).levels, [tier]: level } })
  const setLimit = (rule: ScoreRule, name: string, value: number) =>
    setRule(rule, { ...override(rule), limits: { ...override(rule).limits, [name]: value } })

  return (
    <div className="score-editor">
      <p className="prediction-hint">
        Changes apply at once and are kept in this browser. A rule gives each team an edge from -1 to +1; its points
        are the edge times the weight. "Full edge at gap": the difference at which a metric fully favours one team.
      </p>
      <div className="score-editor-general">
        {EDITABLE_LEVELS.map((level) => (
          <NumberField
            key={level}
            label={`Points for ${level}`}
            value={points[level]}
            onCommit={(value) => onChange({ ...settings, points: { ...settings.points, [level]: value } })}
          />
        ))}
        <NumberField
          label="Confidence knob (bigger = closer to 50%)"
          value={settings.scale ?? SCORE_SCALE}
          onCommit={(value) => value > 0 && onChange({ ...settings, scale: value })}
        />
        <button type="button" className="check-btn" onClick={() => onChange({})}>
          Reset all
        </button>
      </div>
      {SCORE_TABLES.map(({ table, rows }) => (
        <table key={table} className="stats-table score-editor-table">
          <thead>
            <tr>
              <th>{table}</th>
              <th>Weights</th>
              <th>Limits</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, rule }) =>
              rule ? (
                <tr key={rule.key} className={settings.rules?.[rule.key] ? 'score-editor-changed' : undefined}>
                  <td className="row-label">{label}</td>
                  <td>
                    {Object.keys(rule.levels).map((tier) => (
                      <label key={tier} className="score-field">
                        {nameOf(rule, tier)}
                        <select
                          aria-label={`${label}: ${nameOf(rule, tier)}`}
                          value={override(rule).levels?.[tier] ?? rule.levels[tier]}
                          onChange={(e) => setLevel(rule, tier, e.target.value as WeightLevel)}
                        >
                          {LEVELS.map((level) => (
                            <option key={level} value={level}>
                              {level} ({points[level]})
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </td>
                  <td>
                    {Object.entries(rule.limits ?? {}).map(([name, value]) => (
                      <NumberField
                        key={name}
                        label={nameOf(rule, name)}
                        fullLabel={`${label}: ${nameOf(rule, name)}`}
                        value={override(rule).limits?.[name] ?? value}
                        onCommit={(next) => setLimit(rule, name, next)}
                      />
                    ))}
                  </td>
                  <td>
                    {settings.rules?.[rule.key] && (
                      <button type="button" className="check-btn" onClick={() => setRule(rule, null)}>
                        Reset
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                <tr key={label} className="score-editor-unscored">
                  <td className="row-label">{label}</td>
                  <td colSpan={3}>Not scored</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      ))}
    </div>
  )
}

export default ScoreWeightsEditor
