Code.require_file("../support/test_utils.ex", __DIR__)

defmodule RiichiAdvanced.BuilderMahjongMechanicsTest do
  use ExUnit.Case, async: true
  alias RiichiAdvanced.LogControlState, as: LogControl
  alias RiichiAdvanced.TestUtils, as: TestUtils
  alias RiichiAdvanced.Utils, as: Utils

  test "builder-mahjong - CI/CD Kan can be declared by adding 6p to a closed 789p" do
    test_state =
      TestUtils.initialize_test_state("builder-mahjong", [], """
      {
        "starting_hand": {
          "east": ["1m", "2m", "3m", "4m", "5m", "6m", "3s", "3s", "1z", "1z", "7p", "8p", "9p"],
          "south": ["2m", "4m", "7m", "1p", "5p", "8p", "3s", "4s", "5s", "6s", "7s", "8s", "9s"],
          "west": ["2m", "4m", "7m", "1p", "5p", "8p", "3s", "4s", "5s", "6s", "7s", "8s", "9s"],
          "north": ["2m", "4m", "7m", "1p", "5p", "8p", "3s", "4s", "5s", "6s", "7s", "8s", "9s"]
        },
        "starting_draws": ["6p"],
        "starting_dead_wall": ["1z"]
      }
      """)

    state = GenServer.call(test_state.game_state_pid, :get_state)
    assert "cicd_ankan" in state.players.east.buttons

    test_state =
      LogControl.send_button_press(test_state, true, %{
        "type" => "buttons_pressed",
        "buttons" => [
          %{"button" => "cicd_ankan", "call_choice" => ["7p", "8p", "9p"], "called_tile" => "6p"},
          nil,
          nil,
          nil
        ]
      })

    state = GenServer.call(test_state.game_state_pid, :get_state)
    assert [{"ankan", call}] = state.players.east.calls

    assert MapSet.new(Enum.map(Utils.call_to_tiles({"ankan", call}), &Utils.strip_attrs/1)) ==
             MapSet.new([:"6p", :"7p", :"8p", :"9p"])

    assert Enum.all?(call, &(not Utils.has_attr?(&1, ["_facedown"])))

    GenServer.cast(test_state.game_state_pid, :terminate_game)
  end

  test "builder-mahjong - CI/CD Kan Open upgrades chii 789p into 6789p with a self-drawn 6p" do
    TestUtils.test_yaku_advanced(
      "builder-mahjong",
      [],
      """
      {
        "starting_hand": {
          "east": ["1m", "2m", "3m", "4m", "5m", "6m", "3s", "3s", "1z", "1z", "8p", "9p", "5z"],
          "south": ["3m", "4m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "6p", "7s"],
          "west": ["3m", "4m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "6p", "8s"],
          "north": ["3m", "4m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "6p", "9s"]
        },
        "starting_draws": ["1z", "1z", "1z", "7p", "1z", "1z", "1z", "6p", "3s"],
        "starting_dead_wall": ["1z"]
      }
      """,
      [
        %{"type" => "discard", "tile" => "1z", "player" => 0, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "1z", "player" => 1, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "1z", "player" => 2, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "7p", "player" => 3, "tsumogiri" => true},
        %{
          "type" => "buttons_pressed",
          "buttons" => [
            %{"button" => "chii", "call_choice" => ["8p", "9p"], "called_tile" => "7p"},
            nil,
            nil,
            nil
          ]
        },
        %{"type" => "discard", "tile" => "5z", "player" => 0, "tsumogiri" => false},
        %{"type" => "discard", "tile" => "1z", "player" => 1, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "1z", "player" => 2, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "1z", "player" => 3, "tsumogiri" => true},
        %{
          "type" => "buttons_pressed",
          "buttons" => [
            %{"button" => "kakan", "call_choice" => ["7p", "8p", "9p"], "called_tile" => "6p"},
            nil,
            nil,
            nil
          ]
        },
        %{"type" => "discard", "tile" => "1z", "player" => 0, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "3s", "player" => 1, "tsumogiri" => true},
        %{"type" => "buttons_pressed", "buttons" => [%{"button" => "ron"}, nil, nil, nil]}
      ],
      %{
        east: %{
          yaku: [{"CI/CD Kan Open", 2}],
          yaku2: []
        }
      }
    )
  end

  test "builder-mahjong - Web Application Kan can be declared by adding 9s to a closed hand" do
    test_state =
      TestUtils.initialize_test_state("builder-mahjong", [], """
      {
        "starting_hand": {
          "east": ["1m", "2m", "3m", "4m", "5m", "6m", "3s", "3s", "1z", "1z", "3p", "2m", "7s"],
          "south": ["2m", "4m", "7m", "1p", "5p", "8p", "3s", "4s", "5s", "6s", "7s", "8s", "9s"],
          "west": ["2m", "4m", "7m", "1p", "5p", "8p", "3s", "4s", "5s", "6s", "7s", "8s", "9s"],
          "north": ["2m", "4m", "7m", "1p", "5p", "8p", "3s", "4s", "5s", "6s", "7s", "8s", "9s"]
        },
        "starting_draws": ["9s"],
        "starting_dead_wall": ["1z"]
      }
      """)

    state = GenServer.call(test_state.game_state_pid, :get_state)
    assert "web_application_ankan" in state.players.east.buttons

    test_state =
      LogControl.send_button_press(test_state, true, %{
        "type" => "buttons_pressed",
        "buttons" => [
          %{"button" => "web_application_ankan", "call_choice" => ["3p", "2m", "7s"], "called_tile" => "9s"},
          nil,
          nil,
          nil
        ]
      })

    state = GenServer.call(test_state.game_state_pid, :get_state)
    assert [{"ankan", call}] = state.players.east.calls

    assert MapSet.new(Enum.map(Utils.call_to_tiles({"ankan", call}), &Utils.strip_attrs/1)) ==
             MapSet.new([:"3p", :"2m", :"7s", :"9s"])

    assert Enum.all?(call, &(not Utils.has_attr?(&1, ["_facedown"])))

    GenServer.cast(test_state.game_state_pid, :terminate_game)
  end

  test "builder-mahjong - Web Application Kan Open can be called on 9s and win later" do
    TestUtils.test_yaku_advanced(
      "builder-mahjong",
      [],
      """
      {
        "starting_hand": {
          "east": ["1m", "2m", "3m", "4m", "5m", "6m", "3s", "3s", "1z", "1z", "3p", "2m", "7s"],
          "south": ["3m", "4m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "6p", "7s"],
          "west": ["3m", "4m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "6p", "8s"],
          "north": ["3m", "4m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "6p", "9s"]
        },
        "starting_draws": ["5z", "1z", "1z", "9s", "3s"],
        "starting_dead_wall": ["5z"]
      }
      """,
      [
        %{"type" => "discard", "tile" => "5z", "player" => 0, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "1z", "player" => 1, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "1z", "player" => 2, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "9s", "player" => 3, "tsumogiri" => true},
        %{
          "type" => "buttons_pressed",
          "buttons" => [
            %{"button" => "web_application_daiminkan", "call_choice" => ["3p", "2m", "7s"], "called_tile" => "9s"},
            nil,
            nil,
            nil
          ]
        },
        %{"type" => "discard", "tile" => "5z", "player" => 0, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "3s", "player" => 1, "tsumogiri" => true},
        %{"type" => "buttons_pressed", "buttons" => [%{"button" => "ron"}, nil, nil, nil]}
      ],
      %{
        east: %{
          yaku: [{"In-Memory Cache", 1}, {"Web Application Kan Open", 2}],
          yaku2: []
        }
      }
    )
  end

  test "builder-mahjong - Blue/Green Deploy Kan can be declared from a closed hand" do
    test_state =
      TestUtils.initialize_test_state("builder-mahjong", [], """
      {
        "starting_hand": {
          "east": ["1m", "2m", "3m", "4m", "5m", "6m", "3s", "3s", "1z", "1z", "3p", "3m", "6m"],
          "south": ["2m", "4m", "7m", "1p", "5p", "8p", "3s", "4s", "5s", "6s", "7s", "8s", "9s"],
          "west": ["2m", "4m", "7m", "1p", "5p", "8p", "3s", "4s", "5s", "6s", "7s", "8s", "9s"],
          "north": ["2m", "4m", "7m", "1p", "5p", "8p", "3s", "4s", "5s", "6s", "7s", "8s", "9s"]
        },
        "starting_draws": ["7s"],
        "starting_dead_wall": ["1z"]
      }
      """)

    state = GenServer.call(test_state.game_state_pid, :get_state)
    assert "blue_green_deploy_ankan_7s" in state.players.east.buttons

    test_state =
      LogControl.send_button_press(test_state, true, %{
        "type" => "buttons_pressed",
        "buttons" => [
          %{"button" => "blue_green_deploy_ankan_7s", "call_choice" => ["3p", "3m", "6m"], "called_tile" => "7s"},
          nil,
          nil,
          nil
        ]
      })

    state = GenServer.call(test_state.game_state_pid, :get_state)
    assert [{"ankan", call}] = state.players.east.calls

    assert MapSet.new(Enum.map(Utils.call_to_tiles({"ankan", call}), &Utils.strip_attrs/1)) ==
             MapSet.new([:"3p", :"3m", :"6m", :"7s"])

    assert Enum.all?(call, &(not Utils.has_attr?(&1, ["_facedown"])))

    GenServer.cast(test_state.game_state_pid, :terminate_game)
  end

  test "builder-mahjong - Blue/Green Deploy Kan wins as a closed yaku" do
    TestUtils.test_yaku_advanced(
      "builder-mahjong",
      [],
      """
      {
        "starting_hand": {
          "east": ["1m", "2m", "3m", "4m", "5m", "6m", "3s", "3s", "1z", "1z", "3p", "3m", "6m"],
          "south": ["3m", "4m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "6p", "7s"],
          "west": ["3m", "4m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "6p", "8s"],
          "north": ["3m", "4m", "5m", "6m", "7m", "8m", "1p", "2p", "3p", "4p", "5p", "6p", "9s"]
        },
        "starting_draws": ["7s", "3s"],
        "starting_dead_wall": ["5z"]
      }
      """,
      [
        %{
          "type" => "buttons_pressed",
          "buttons" => [
            %{"button" => "blue_green_deploy_ankan_7s", "call_choice" => ["3p", "3m", "6m"], "called_tile" => "7s"},
            nil,
            nil,
            nil
          ]
        },
        %{"type" => "discard", "tile" => "5z", "player" => 0, "tsumogiri" => true},
        %{"type" => "discard", "tile" => "3s", "player" => 1, "tsumogiri" => true},
        %{"type" => "buttons_pressed", "buttons" => [%{"button" => "ron"}, nil, nil, nil]}
      ],
      %{
        east: %{
          yaku: [{"Blue/Green Deploy Kan", 3}, {"Web Application", 1}],
          yaku2: []
        }
      }
    )
  end
end
