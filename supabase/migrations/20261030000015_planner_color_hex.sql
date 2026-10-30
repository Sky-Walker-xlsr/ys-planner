-- ys-planner: Planner-Farbe frei wählbar, aber nur als Hex-Wert.
-- Der Wert landet im style-Attribut anderer Mitglieder; url(...) o. Ä. darf dort nicht hin.
alter table public.planners add constraint planners_color_hex_check check (color ~ '^#[0-9a-fA-F]{6}$');
