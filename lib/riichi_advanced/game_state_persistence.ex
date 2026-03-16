defmodule RiichiAdvanced.GameStatePersistence do
  @moduledoc """
  GameStateのValkey永続化。
  各操作後にスナップショットをValkeyに保存する。
  """

  alias RiichiAdvanced.ValkeyAdapter
  alias RiichiAdvanced.StateSerializer

  @prefix "game_state:"
  @ttl 7200  # 2時間

  @spec save(String.t(), String.t(), term()) :: :ok | {:error, term()}
  def save(ruleset, room_code, state) do
    key = @prefix <> "#{ruleset}:#{room_code}"
    sanitized = sanitize_for_persistence(state)
    binary = StateSerializer.serialize(sanitized)
    case ValkeyAdapter.command(["SET", key, binary, "EX", @ttl]) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @spec load(String.t(), String.t()) :: {:ok, term()} | :not_found
  def load(ruleset, room_code) do
    key = @prefix <> "#{ruleset}:#{room_code}"
    case ValkeyAdapter.command(["GET", key]) do
      {:ok, nil} -> :not_found
      {:ok, binary} -> StateSerializer.deserialize(binary)
      {:error, _} -> :not_found
    end
  end

  @spec delete(String.t(), String.t()) :: :ok
  def delete(ruleset, room_code) do
    key = @prefix <> "#{ruleset}:#{room_code}"
    ValkeyAdapter.command(["DEL", key])
    :ok
  end

  @doc """
  PID、Reference等のシリアライズ不可能なフィールドをnilに置換する。
  復元時にはこれらのフィールドは再構築される。
  """
  def sanitize_for_persistence(state) do
    %{state |
      # Process PIDs
      supervisor: nil,
      mutex: nil,
      smt_solver: nil,
      ai_supervisor: nil,
      exit_monitor: nil,
      # Debouncer PIDs and transient state
      play_tile_debounce: nil,
      play_tile_debouncers: nil,
      big_text_debouncers: nil,
      timer_debouncer: nil,
      # AI process PIDs (east/south/west/north hold AI PIDs)
      east: nil,
      south: nil,
      west: nil,
      north: nil,
      # Messages GenServer PIDs
      messages_states: Map.new(state.available_seats, fn seat -> {seat, nil} end),
      # Async calculation PIDs
      calculate_playable_indices_pids: Map.new(state.available_seats, fn seat -> {seat, nil} end),
      calculate_closest_american_hands_pid: nil,
      get_best_minefield_hand_pid: nil,
      # NIF reference (reconstructed from ruleset + mods + config via Rules.load_rules/2)
      rules_ref: nil
    }
  end
end
