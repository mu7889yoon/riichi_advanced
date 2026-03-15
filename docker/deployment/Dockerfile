# Build stage
FROM elixir:1.17-otp-27 AS builder

ENV MIX_ENV=prod

RUN apt-get update && apt-get install -y \
    build-essential \
    jq \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

# Install dependencies
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile

# Install Node dependencies
COPY assets/package.json assets/package-lock.json ./assets/
RUN cd assets && npm ci

# Copy application source
COPY config config
COPY lib lib
COPY assets assets
COPY priv priv

# Build assets and compile
RUN mix assets.deploy 2>/dev/null || (mix esbuild.install && mix esbuild riichi_advanced --minify && mix phx.digest)
RUN mix compile

# Runtime stage
FROM elixir:1.17-otp-27-slim

ENV MIX_ENV=prod

RUN apt-get update && apt-get install -y \
    jq \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

COPY --from=builder /app/_build /app/_build
COPY --from=builder /app/deps /app/deps
COPY --from=builder /app/config /app/config
COPY --from=builder /app/lib /app/lib
COPY --from=builder /app/priv /app/priv
COPY --from=builder /app/mix.exs /app/mix.lock ./

EXPOSE 4000

CMD ["mix", "phx.server"]
