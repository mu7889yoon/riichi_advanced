defmodule RiichiAdvanced.GameStatePersistenceTest do
  use ExUnit.Case, async: false

  @moduletag :valkey

  alias RiichiAdvanced.GameStatePersistence
  alias RiichiAdvanced.ValkeyAdapter

  # Validates: Requirements 8.3, 8.4, 8.5

  @prefix "game_state:"

  # Build a minimal fake game state map that mimics the fields GameStatePersistence expects.
  defp fake_game_state do
    %{
      ruleset: "riichi",
      room_code: "ABCD",
      mods: ["mod1", "mod2"],
      config: nil,
      private: false,
      available_seats: [:east, :south, :west, :north],
      game_active: true,
      wall: ["1m", "2m", "3m"],
      kyoku: 0,
      honba: 0,
      pot: 0,
      turn: :east,
      # PID fields that should be sanitized
      supervisor: self(),
      mutex: self(),
      smt_solver: self(),
      ai_supervisor: self(),
      exit_monitor: self(),
      play_tile_debounce: self(),
      play_tile_debouncers: %{east: self(), south: self(), west: self(), north: self()},
      big_text_debouncers: %{east: self(), south: self(), west: self(), north: self()},
      timer_debouncer: self(),
      east: self(),
      south: self(),
      west: self(),
      north: self(),
      messages_states: %{east: self(), south: self(), west: self(), north: self()},
      calculate_playable_indices_pids: %{east: self(), south: self(), west: self(), north: self()},
      calculate_closest_american_hands_pid: self(),
      get_best_minefield_hand_pid: self(),
      rules_ref: make_ref()
    }
  end

  # Generate unique identifiers per test to avoid key collisions
  defp unique_ids do
    id = System.unique_integer([:positive])
    {"ruleset_#{id}", "room_#{id}"}
  end

  # Clean up Valkey key after test
  defp cleanup(ruleset, room_code) do
    ValkeyAdapter.command(["DEL", @prefix <> "#{ruleset}:#{room_code}"])
  end

  describe "sanitize_for_persistence/1" do
    test "nils out PID fields" do
      state = fake_game_state()
      sanitized = GameStatePersistence.sanitize_for_persistence(state)

      assert sanitized.supervisor == nil
      assert sanitized.mutex == nil
      assert sanitized.smt_solver == nil
      assert sanitized.ai_supervisor == nil
      assert sanitized.exit_monitor == nil
      assert sanitized.play_tile_debounce == nil
      assert sanitized.play_tile_debouncers == nil
      assert sanitized.big_text_debouncers == nil
      assert sanitized.timer_debouncer == nil
      assert sanitized.east == nil
      assert sanitized.south == nil
      assert sanitized.west == nil
      assert sanitized.north == nil
      assert sanitized.calculate_closest_american_hands_pid == nil
      assert sanitized.get_best_minefield_hand_pid == nil
    end

    test "nils out rules_ref" do
      state = fake_game_state()
      sanitized = GameStatePersistence.sanitize_for_persistence(state)

      assert sanitized.rules_ref == nil
    end

    test "replaces messages_states with nil-valued map keyed by available_seats" do
      state = fake_game_state()
      sanitized = GameStatePersistence.sanitize_for_persistence(state)

      expected = %{east: nil, south: nil, west: nil, north: nil}
      assert sanitized.messages_states == expected
    end

    test "replaces calculate_playable_indices_pids with nil-valued map keyed by available_seats" do
      state = fake_game_state()
      sanitized = GameStatePersistence.sanitize_for_persistence(state)

      expected = %{east: nil, south: nil, west: nil, north: nil}
      assert sanitized.calculate_playable_indices_pids == expected
    end

    test "preserves non-PID fields" do
      state = fake_game_state()
      sanitized = GameStatePersistence.sanitize_for_persistence(state)

      assert sanitized.ruleset == "riichi"
      assert sanitized.room_code == "ABCD"
      assert sanitized.mods == ["mod1", "mod2"]
      assert sanitized.available_seats == [:east, :south, :west, :north]
      assert sanitized.game_active == true
      assert sanitized.wall == ["1m", "2m", "3m"]
      assert sanitized.kyoku == 0
      assert sanitized.honba == 0
      assert sanitized.pot == 0
      assert sanitized.turn == :east
    end
  end

  describe "save/3 then load/2 round-trip" do
    test "saved state can be loaded back" do
      {ruleset, room_code} = unique_ids()
      state = fake_game_state()

      assert :ok = GameStatePersistence.save(ruleset, room_code, state)
      assert {:ok, loaded} = GameStatePersistence.load(ruleset, room_code)

      # Loaded state should match the sanitized version (PIDs nilled out)
      sanitized = GameStatePersistence.sanitize_for_persistence(state)
      assert loaded.ruleset == sanitized.ruleset
      assert loaded.room_code == sanitized.room_code
      assert loaded.mods == sanitized.mods
      assert loaded.available_seats == sanitized.available_seats
      assert loaded.game_active == sanitized.game_active
      assert loaded.wall == sanitized.wall
      assert loaded.supervisor == nil
      assert loaded.mutex == nil
      assert loaded.rules_ref == nil

      cleanup(ruleset, room_code)
    end
  end

  describe "delete/2" do
    test "removes the state from Valkey" do
      {ruleset, room_code} = unique_ids()
      state = fake_game_state()

      :ok = GameStatePersistence.save(ruleset, room_code, state)
      assert {:ok, _} = GameStatePersistence.load(ruleset, room_code)

      :ok = GameStatePersistence.delete(ruleset, room_code)
      assert :not_found == GameStatePersistence.load(ruleset, room_code)
    end
  end

  describe "load/2 for non-existent state" do
    test "returns :not_found when state was never saved" do
      {ruleset, room_code} = unique_ids()

      assert :not_found == GameStatePersistence.load(ruleset, room_code)
    end
  end

  describe "TTL on saved state" do
    test "saved state has TTL set to 7200 seconds" do
      {ruleset, room_code} = unique_ids()
      state = fake_game_state()

      :ok = GameStatePersistence.save(ruleset, room_code, state)

      key = @prefix <> "#{ruleset}:#{room_code}"
      {:ok, ttl} = ValkeyAdapter.command(["TTL", key])

      assert ttl > 0
      assert ttl <= 7200

      cleanup(ruleset, room_code)
    end
  end
end
