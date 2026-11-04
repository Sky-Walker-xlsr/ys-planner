-- Direkt teilen: Dateien und Nachrichten zwischen zwei Browsern per WebRTC.
--
-- Inhalte laufen nie über Supabase, nur der Verbindungsaufbau (SDP-Angebot/-Antwort, ICE-Kandidaten)
-- und Presence gehen über den privaten Realtime-Channel p2p:{session_id}. Die Session-ID ist
-- 32 Hex-Zeichen zufällig und steht nur im Einladungslink. Gäste von Share-Links sind ausgeschlossen.

create policy realtime_p2p_read on realtime.messages for select to authenticated
  using (
    realtime.topic() ~ '^p2p:[0-9a-f]{32}$'
    and not app.is_guest()
  );
create policy realtime_p2p_write on realtime.messages for insert to authenticated
  with check (
    realtime.topic() ~ '^p2p:[0-9a-f]{32}$'
    and not app.is_guest()
  );
