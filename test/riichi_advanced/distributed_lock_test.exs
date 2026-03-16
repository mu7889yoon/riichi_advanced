defmodule RiichiAdvanced.DistributedLockTest do
  use ExUnit.Case, async: false

  @moduletag :valkey

  alias RiichiAdvanced.DistributedLock
  alias RiichiAdvanced.ValkeyAdapter

  # Validates: Requirements 8.1, 8.2

  @prefix "lock:"

  # Clean up lock keys after tests
  defp cleanup(resource) do
    ValkeyAdapter.command(["DEL", @prefix <> resource])
  end

  # Generate a unique resource name per test to avoid collisions
  defp unique_resource do
    "resource_#{System.unique_integer([:positive])}"
  end

  describe "acquire/1" do
    test "returns {:ok, token} for an unlocked resource" do
      resource = unique_resource()

      assert {:ok, token} = DistributedLock.acquire(resource)
      assert is_binary(token)
      assert byte_size(token) > 0

      cleanup(resource)
    end

    test "second acquire on same resource returns {:error, :locked}" do
      resource = unique_resource()

      assert {:ok, _token} = DistributedLock.acquire(resource)
      assert {:error, :locked} = DistributedLock.acquire(resource)

      cleanup(resource)
    end
  end

  describe "release/2" do
    test "with correct token returns :ok" do
      resource = unique_resource()

      {:ok, token} = DistributedLock.acquire(resource)
      assert :ok = DistributedLock.release(resource, token)
    end

    test "with wrong token returns {:error, :not_owner}" do
      resource = unique_resource()

      {:ok, _token} = DistributedLock.acquire(resource)
      wrong_token = "WRONG_TOKEN_VALUE"

      assert {:error, :not_owner} = DistributedLock.release(resource, wrong_token)

      cleanup(resource)
    end
  end

  describe "acquire after release" do
    test "resource can be acquired again after release" do
      resource = unique_resource()

      {:ok, token} = DistributedLock.acquire(resource)
      :ok = DistributedLock.release(resource, token)

      assert {:ok, new_token} = DistributedLock.acquire(resource)
      assert new_token != token

      cleanup(resource)
    end
  end

  describe "lock TTL expiry" do
    test "lock expires after TTL allowing re-acquisition" do
      resource = unique_resource()

      # Acquire with a very short TTL (100ms)
      assert {:ok, _token} = DistributedLock.acquire(resource, ttl: 100)

      # Immediately, the lock should still be held
      assert {:error, :locked} = DistributedLock.acquire(resource)

      # Wait for the TTL to expire
      Process.sleep(150)

      # Now the lock should be available again
      assert {:ok, _new_token} = DistributedLock.acquire(resource)

      cleanup(resource)
    end
  end
end
