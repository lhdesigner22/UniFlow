import s from './LevelSwitch.module.css'

// Seletor de 3 posições (Sem acesso | Ver | Editar) de uma área — usado na matriz
// de Cargos e no "O que aparece" do departamento. Por baixo são rádios de verdade
// (setas do teclado trocam a opção), só que desenhados como um segmento.
// options: [{ key, label, hint, tone: 'off' | 'view' | 'edit' }]
export default function LevelSwitch({ name, value, options, onChange, disabled, label }) {
  return (
    <div className={s.switch} role="radiogroup" aria-label={label} data-disabled={disabled || undefined}>
      {options.map(o => (
        <label key={o.key} className={s.seg} data-tone={o.tone} title={o.hint}>
          <input
            type="radio" name={name} value={o.key}
            checked={value === o.key} disabled={disabled}
            onChange={() => onChange(o.key)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}
