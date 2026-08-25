#!/bin/bash

tmux kill-session -t dev
docker compose -f docker-compose.dev.yml down