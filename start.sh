#!/bin/bash

tmux new-session -d -s dev

tmux send-keys -t dev "docker compose -f docker-compose.dev.yml up" C-m

sleep 8

tmux split-window -h
tmux send-keys "cd dashboard && npm run dev" C-m

tmux split-window -v
tmux send-keys "cd dashboard && npx prisma studio" C-m

tmux select-pane -t 0
tmux split-window -v
tmux send-keys "cd proxy && source venv/bin/activate && python main.py" C-m

tmux attach -t dev

#sudo apt install tmux

# chmod +x start.sh
# ./start.sh

#tmux kill-session -t dev