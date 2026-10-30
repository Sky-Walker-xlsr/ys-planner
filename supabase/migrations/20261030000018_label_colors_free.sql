-- ys-planner: Label-Farbe frei wählbar. Die sechs benannten Farben bleiben für bestehende Labels gültig.
-- Der Wert landet im style-Attribut anderer Mitglieder, deshalb nur Hex und keine beliebigen Texte.
alter table public.labels drop constraint labels_color_check;
alter table public.labels add constraint labels_color_check
  check (color in ('blue', 'violet', 'orange', 'pink', 'teal', 'yellow') or color ~ '^#[0-9a-fA-F]{6}$');
