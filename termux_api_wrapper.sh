#!/usr/bin/env bash
# Sanitized wrapper for Termux:API functions

COMMAND=$1
shift

case "$COMMAND" in
    clipboard-get)
        termux-clipboard-get
        ;;
    clipboard-set)
        termux-clipboard-set "$@"
        ;;
    battery-status)
        termux-battery-status
        ;;
    vibrate)
        # Limit duration to 1000ms
        DURATION=${1:-500}
        if [ "$DURATION" -gt 1000 ]; then DURATION=1000; fi
        termux-vibrate -d "$DURATION"
        ;;
    notification)
        # Basic notification wrapper
        TITLE=$1
        CONTENT=$2
        termux-notification --title "$TITLE" --content "$CONTENT"
        ;;
    location)
        termux-location
        ;;
    *)
        echo "Unknown or unsupported Termux:API command: $COMMAND" >&2
        exit 1
        ;;
esac
