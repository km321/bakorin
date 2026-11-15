FROM oven/bun:1.4
WORKDIR /project
COPY app.yaml hooks.ts ./
ENV NODE_ENV=production
ENV BAKORIN_ENV=production
ENV BAKORIN_DATA_DIR=/data
EXPOSE 4371
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||4371)+'/health').then(r=>process.exit(r.ok?0:1))"
CMD ["bunx", "--bun", "bakorin", "start"]
