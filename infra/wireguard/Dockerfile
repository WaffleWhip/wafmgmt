FROM alpine:3.24
RUN apk add --no-cache wireguard-tools iptables iproute2
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]