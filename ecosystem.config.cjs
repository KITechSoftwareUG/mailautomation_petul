module.exports = {
    apps: [
        {
            name: "petul-mail-automation",
            script: "npx",
            args: "tsx src/index.ts",
            interpreter: "none",
            watch: false,
            max_memory_restart: "1G",
            env: {
                NODE_ENV: "production",
            },
            error_file: "logs/err.log",
            out_file: "logs/out.log",
            merge_logs: true,
            time: true,
        },
    ],
};
