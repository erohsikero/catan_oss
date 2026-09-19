import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, PLAYER_COLORS, type PlayerColor, type RoomSummary } from '@hexhaven/shared';
import { PLAYER_PALETTE } from '../three/theme.js';
import type { Connection } from '../net/useConnection.js';

/** The front door: pick a name, then host a table or join one by code. */
export function Lobby({ conn }: { conn: Connection }) {
  const [roomName, setRoomName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="shell">
      <div className="lobby">
        <header className="brand">
          <h1>HEXHAVEN</h1>
          <p>Settle the island. Trade, build, and race to ten victory points.</p>
        </header>

        <div className="card panel">
          <h2>Who are you?</h2>
          <div className="row">
            <input
              type="text"
              value={conn.name}
              placeholder="Your name"
              maxLength={24}
              onChange={(e) => conn.setName(e.target.value)}
            />
          </div>
        </div>

        <div className="lobby-grid">
          <div className="card panel">
            <h2>Host a table</h2>
            <div className="field">
              <label htmlFor="room-name">Table name</label>
              <input
                id="room-name"
                type="text"
                value={roomName}
                placeholder={`${conn.name || 'Your'}'s table`}
                maxLength={40}
                onChange={(e) => setRoomName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="room-pass">Password (optional)</label>
              <input
                id="room-pass"
                type="password"
                value={password}
                placeholder="Leave empty for an open table"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => conn.send({ t: 'create_room', name: roomName, password: password || undefined })}
            >
              Create table
            </button>
          </div>

          <div className="card panel">
            <h2>Join with a code</h2>
            <div className="field">
              <label htmlFor="join-code">Table code</label>
              <input
                id="join-code"
                type="text"
                value={joinCode}
                placeholder="ABCD"
                maxLength={8}
                style={{ letterSpacing: '0.2em', textTransform: 'uppercase' }}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              />
            </div>
            <div className="field">
              <label htmlFor="join-pass">Password</label>
              <input
                id="join-pass"
                type="password"
                value={password}
                placeholder="If the table has one"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button
              className="btn"
              disabled={joinCode.trim().length < 3}
              onClick={() => conn.send({ t: 'join_room', roomId: joinCode.trim(), password: password || undefined })}
            >
              Join table
            </button>
          </div>
        </div>

        <div className="card panel">
          <h2>Open tables</h2>
          {conn.rooms.length === 0 ? (
            <p className="muted tiny" style={{ margin: 0 }}>
              No one is waiting right now. Host a table and share the code.
            </p>
          ) : (
            <div className="room-list">
              {conn.rooms.map((room) => (
                <RoomRow key={room.id} room={room} onJoin={() => conn.send({ t: 'join_room', roomId: room.id })} />
              ))}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => conn.send({ t: 'list_rooms' })}>
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoomRow({ room, onJoin }: { room: RoomSummary; onJoin: () => void }) {
  const full = room.players.length >= room.maxPlayers;
  return (
    <div className="room-row">
      <span className="room-code">{room.id}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {room.name}
        {room.hasPassword && <span className="faint tiny"> &nbsp;&#128274;</span>}
      </span>
      <span className="muted tiny">
        {room.players.length}/{room.maxPlayers}
      </span>
      <button className="btn btn-sm" disabled={full} onClick={onJoin}>
        {full ? 'Full' : 'Join'}
      </button>
    </div>
  );
}

/** The waiting room: seats, colours, bots and the host's settings. */
export function RoomView({ conn }: { conn: Connection }) {
  const { view, settings, playerId, roomId } = conn;
  if (!view || !settings || !roomId) {
    return (
      <div className="shell">
        <div className="panel card" style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
          <div className="spinner" />
          <span className="muted">Taking a seat&hellip;</span>
        </div>
      </div>
    );
  }

  const isHost = view.players.length > 0 && playerId !== null;
  const seats = view.players;
  const takenColors = new Set(seats.map((s) => s.color));
  const canStart = seats.length >= MIN_PLAYERS;

  return (
    <div className="shell">
      <div className="lobby">
        <header className="brand">
          <h1>{roomId}</h1>
          <p>Share this code. {seats.length} of {MAX_PLAYERS} seats taken.</p>
        </header>

        <div className="lobby-grid">
          <div className="card panel">
            <h2>At the table</h2>
            <div className="seat-list">
              {seats.map((seat) => (
                <div className="seat" key={seat.id}>
                  <span className="swatch" style={{ background: PLAYER_PALETTE[seat.color].base }} />
                  <span style={{ flex: 1 }}>
                    {seat.name}
                    {seat.id === playerId && <span className="faint tiny"> (you)</span>}
                    {seat.isBot && <span className="faint tiny"> &middot; bot</span>}
                  </span>
                  {isHost && seat.id !== playerId && (
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => conn.send({ t: 'remove_player', playerId: seat.id })}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="field">
              <label>Your colour</label>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {PLAYER_COLORS.map((color) => {
                  const mine = seats.find((s) => s.id === playerId)?.color === color;
                  return (
                    <button
                      key={color}
                      className="swatch-btn"
                      aria-pressed={mine}
                      title={PLAYER_PALETTE[color].label}
                      disabled={takenColors.has(color) && !mine}
                      style={{ background: PLAYER_PALETTE[color].base }}
                      onClick={() => conn.send({ t: 'set_color', color: color as PlayerColor })}
                    />
                  );
                })}
              </div>
            </div>

            <div className="row">
              <button
                className="btn"
                disabled={seats.length >= MAX_PLAYERS}
                onClick={() => conn.send({ t: 'add_bot' })}
              >
                Add a bot
              </button>
              <button className="btn btn-ghost" onClick={() => conn.send({ t: 'leave_room' })}>
                Leave
              </button>
            </div>
          </div>

          <div className="card panel">
            <h2>Table rules</h2>
            <div className="field">
              <label htmlFor="vp">Victory points to win</label>
              <input
                id="vp"
                type="number"
                min={3}
                max={20}
                value={settings.victoryPoints}
                onChange={(e) =>
                  conn.send({ t: 'set_settings', settings: { victoryPoints: Number(e.target.value) } })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="layout">Island layout</label>
              <select
                id="layout"
                value={settings.board.layout ?? 'balanced'}
                onChange={(e) =>
                  conn.send({
                    t: 'set_settings',
                    settings: { board: { ...settings.board, layout: e.target.value as 'classic' } },
                  })
                }
              >
                <option value="balanced">Random, no touching 6s and 8s</option>
                <option value="random">Fully random</option>
                <option value="classic">Classic beginner island</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="clock">Turn clock (seconds, 0 for none)</label>
              <input
                id="clock"
                type="number"
                min={0}
                max={600}
                step={15}
                value={settings.turnSeconds}
                onChange={(e) => conn.send({ t: 'set_settings', settings: { turnSeconds: Number(e.target.value) } })}
              />
            </div>
            <button className="btn btn-primary" disabled={!canStart} onClick={() => conn.send({ t: 'start_game' })}>
              {canStart ? 'Start the game' : `Need ${MIN_PLAYERS - seats.length} more`}
            </button>
            <p className="faint tiny" style={{ marginTop: 10, marginBottom: 0 }}>
              Only the host can change these or start. Everyone else can pick a colour.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
