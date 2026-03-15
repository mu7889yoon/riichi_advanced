defmodule RiichiAdvanced.ValkeyAdapterTest do
  use ExUnit.Case, async: false

  @moduletag :valkey

  alias RiichiAdvanced.ValkeyAdapter

  # Tests require a running Valkey/Redis instance.
  # Run with: docker compose run --rm -e MIX_ENV=test riichi-advanced mix test test/riichi_advanced/valkey_adapter_test.exs

  describe "connection establishment" do
    test "PING returns PONG" do
      assert {:ok, "PONG"} = ValkeyAdapter.command(["PING"])
    end

    test "PING with message returns the message" do
      assert {:ok, "hello"} = ValkeyAdapter.command(["PING", "hello"])
    end
  end

  describe "connection pool behavior" do
    test "multiple concurrent commands succeed through the pool" do
      tasks =
        for i <- 1..20 do
          Task.async(fn ->
            key = "pool_test:#{i}"
            {:ok, "OK"} = ValkeyAdapter.command(["SET", key, "value_#{i}"])
            {:ok, value} = ValkeyAdapter.command(["GET", key])
            ValkeyAdapter.command(["DEL", key])
            value
          end)
        end

      results = Task.await_many(tasks, 5000)

      for i <- 1..20 do
        assert Enum.at(results, i - 1) == "value_#{i}"
      end
    end
  end

  describe "command/1" do
    test "SET and GET round trip" do
      key = "test:adapter:#{System.unique_integer([:positive])}"

      assert {:ok, "OK"} = ValkeyAdapter.command(["SET", key, "test_value"])
      assert {:ok, "test_value"} = ValkeyAdapter.command(["GET", key])

      # cleanup
      ValkeyAdapter.command(["DEL", key])
    end

    test "GET returns nil for non-existent key" do
      assert {:ok, nil} = ValkeyAdapter.command(["GET", "nonexistent:#{System.unique_integer([:positive])}"])
    end

    test "DEL removes a key" do
      key = "test:adapter:del:#{System.unique_integer([:positive])}"
      ValkeyAdapter.command(["SET", key, "to_delete"])

      assert {:ok, 1} = ValkeyAdapter.command(["DEL", key])
      assert {:ok, nil} = ValkeyAdapter.command(["GET", key])
    end

    test "returns error for invalid command" do
      assert {:error, %Redix.Error{}} = ValkeyAdapter.command(["INVALIDCMD"])
    end
  end

  describe "pipeline/1" do
    test "executes multiple commands in a pipeline" do
      key1 = "test:pipe:#{System.unique_integer([:positive])}"
      key2 = "test:pipe:#{System.unique_integer([:positive])}"

      assert {:ok, results} =
               ValkeyAdapter.pipeline([
                 ["SET", key1, "val1"],
                 ["SET", key2, "val2"],
                 ["GET", key1],
                 ["GET", key2]
               ])

      assert results == ["OK", "OK", "val1", "val2"]

      # cleanup
      ValkeyAdapter.pipeline([["DEL", key1], ["DEL", key2]])
    end

    test "pipeline with empty list raises ArgumentError" do
      assert_raise ArgumentError, fn ->
        ValkeyAdapter.pipeline([])
      end
    end

    test "pipeline handles errors inline" do
      key = "test:pipe:err:#{System.unique_integer([:positive])}"
      ValkeyAdapter.command(["SET", key, "not_a_list"])

      {:ok, results} =
        ValkeyAdapter.pipeline([
          ["GET", key],
          ["LPUSH", key, "item"],
          ["GET", key]
        ])

      assert [_get_result, %Redix.Error{}, _get_result2] = results

      # cleanup
      ValkeyAdapter.command(["DEL", key])
    end
  end
end
