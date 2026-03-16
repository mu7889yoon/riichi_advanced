import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# Nebulex Redis adapter config (all environments)
valkey_url = System.get_env("VALKEY_URL", "redis://localhost:6379")

# ElastiCache Serverless uses wildcard TLS certs
tls_socket_opts =
  if String.starts_with?(valkey_url, "rediss://") do
    [
      customize_hostname_check: [
        match_fun: :public_key.pkix_verify_hostname_match_fun(:https)
      ]
    ]
  else
    []
  end

config :riichi_advanced, RiichiAdvanced.Cache,
  conn_opts:
    [url: valkey_url] ++
      if(tls_socket_opts != [], do: [ssl: true, socket_opts: tls_socket_opts], else: [])

# Phoenix PubSub Redis adapter config (all environments)
pubsub_opts = [
  adapter: Phoenix.PubSub.Redis,
  url: valkey_url,
  node_name: System.get_env("NODE_NAME", "node_#{:erlang.phash2(make_ref())}")
]

pubsub_opts =
  if tls_socket_opts != [] do
    pubsub_opts ++ [ssl: true, socket_opts: tls_socket_opts]
  else
    pubsub_opts
  end

config :riichi_advanced, RiichiAdvanced.PubSub, pubsub_opts

if config_env() == :prod do
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  port = String.to_integer(System.get_env("HTTP_PORT") || "8080")
  host = System.get_env("PHX_HOST") || "localhost"

  config :riichi_advanced, RiichiAdvancedWeb.Endpoint,
    server: true,
    url: [host: host, port: 443, scheme: "https"],
    http: [ip: {0, 0, 0, 0}, port: port],
    check_origin: [
      "https://#{host}",
      "//#{host}"
    ],
    secret_key_base: secret_key_base
end
