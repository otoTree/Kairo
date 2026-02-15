#!/bin/bash
echo "Hello from Binary Skill!"
echo "Environment check: KAIRO_SKILL_NAME=$KAIRO_SKILL_NAME"
if [ -n "$MY_API_KEY" ]; then
  echo "MY_API_KEY=$MY_API_KEY"
fi
# Keep alive for a bit to allow testing process management
sleep 0.5
