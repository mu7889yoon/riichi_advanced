defmodule RiichiAdvanced.DistributedPubSubTest do
  use ExUnit.Case, async: false

  @moduletag :valkey

  # Validates: Requirements 5.2, 5.3

  describe "basic subscribe and broadcast" do
    test "subscriber receives broadcast message on a topic" do
      topic = "pubsub_test:#{System.unique_integer([:positive])}"

      :ok = Phoenix.PubSub.subscribe(RiichiAdvanced.PubSub, topic)
      :ok = Phoenix.PubSub.broadcast(RiichiAdvanced.PubSub, topic, {:ping, "hello"})

      assert_receive {:ping, "hello"}, 1000
    end
  end

  describe "lobby topic pattern" do
    test "lobby:<ruleset> topic receives state_updated messages" do
      ruleset = "riichi_#{System.unique_integer([:positive])}"
      topic = "lobby:" <> ruleset

      :ok = Phoenix.PubSub.subscribe(RiichiAdvanced.PubSub, topic)

      :ok =
        Phoenix.PubSub.broadcast(RiichiAdvanced.PubSub, topic, %{
          event: "state_updated",
          payload: %{"state" => %{ruleset: ruleset, rooms: %{}}}
        })

      assert_receive %{event: "state_updated", payload: %{"state" => %{ruleset: ^ruleset}}},
                     1000
    end
  end

  describe "game topic pattern" do
    test "{ruleset}:{room_code} topic receives state_updated messages" do
      id = System.unique_integer([:positive])
      topic = "riichi_#{id}:room_#{id}"

      :ok = Phoenix.PubSub.subscribe(RiichiAdvanced.PubSub, topic)

      :ok =
        Phoenix.PubSub.broadcast(RiichiAdvanced.PubSub, topic, %{
          event: "state_updated",
          payload: %{"state" => :game_state_placeholder}
        })

      assert_receive %{event: "state_updated", payload: %{"state" => _}}, 1000
    end

    test "{ruleset}:{room_code} topic receives play_sound messages" do
      id = System.unique_integer([:positive])
      topic = "riichi_#{id}:room_#{id}"

      :ok = Phoenix.PubSub.subscribe(RiichiAdvanced.PubSub, topic)

      :ok =
        Phoenix.PubSub.broadcast(RiichiAdvanced.PubSub, topic, %{
          event: "play_sound",
          payload: %{"seat" => :east, "path" => "/sounds/discard.mp3"}
        })

      assert_receive %{event: "play_sound", payload: %{"seat" => :east, "path" => "/sounds/discard.mp3"}},
                     1000
    end
  end

  describe "messages topic pattern" do
    test "messages:<session_id> topic receives messages_updated messages" do
      session_id = "session_#{System.unique_integer([:positive])}"
      topic = "messages:" <> session_id

      :ok = Phoenix.PubSub.subscribe(RiichiAdvanced.PubSub, topic)

      :ok =
        Phoenix.PubSub.broadcast(RiichiAdvanced.PubSub, topic, %{
          event: "messages_updated",
          payload: %{"state" => %{messages: ["hello"]}}
        })

      assert_receive %{event: "messages_updated", payload: %{"state" => _}}, 1000
    end
  end

  describe "unsubscribe" do
    test "unsubscribed process stops receiving messages" do
      topic = "unsub_test:#{System.unique_integer([:positive])}"

      :ok = Phoenix.PubSub.subscribe(RiichiAdvanced.PubSub, topic)

      # Confirm subscription works
      :ok = Phoenix.PubSub.broadcast(RiichiAdvanced.PubSub, topic, :before_unsub)
      assert_receive :before_unsub, 1000

      # Unsubscribe
      :ok = Phoenix.PubSub.unsubscribe(RiichiAdvanced.PubSub, topic)

      # Broadcast again — should NOT be received
      :ok = Phoenix.PubSub.broadcast(RiichiAdvanced.PubSub, topic, :after_unsub)
      refute_receive :after_unsub, 500
    end
  end
end
