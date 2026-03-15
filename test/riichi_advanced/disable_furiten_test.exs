defmodule RiichiAdvanced.DisableFuritenTest do
  use ExUnit.Case, async: true

  @ruleset_path "priv/static/rulesets/aws-mahjong.majs"

  setup_all do
    content = File.read!(@ruleset_path)
    %{content: content}
  end

  describe "furiten removal" do
    test "aws-mahjong.majs does not contain the string 'furiten'", %{content: content} do
      refute content =~ "furiten",
        "Expected aws-mahjong.majs to not contain 'furiten', but it was found"
    end
  end

  describe "tenpai check preservation" do
    test "turn_cleanup still calls check_tenpai", %{content: content} do
      assert {:ok, body} = extract_function_body(content, "turn_cleanup")
      assert body =~ "check_tenpai",
        "Expected turn_cleanup to contain 'check_tenpai', but it was not found"
    end
  end

  defp extract_function_body(content, function_name) do
    regex = ~r/def #{Regex.escape(function_name)} do\n(.*?)\nend/s

    case Regex.run(regex, content) do
      [_full, body] -> {:ok, body}
      _ -> :error
    end
  end
end
