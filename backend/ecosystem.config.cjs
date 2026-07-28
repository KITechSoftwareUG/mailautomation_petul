module.exports = {
    apps: [
        {
            name: "petul-mail-automation",
            script: "npx",
            args: "tsx src/index.ts",
            interpreter: "none",
            watch: false,
            max_memory_restart: "1G",

            // Der Prozess beendet sich jetzt bei unbekannten Fehlerzuständen selbst
            // (uncaughtException) und über den IMAP-Watchdog, statt halbtot weiterzulaufen.
            // Ein sauberer Neustart ist damit der Normalfall — diese Werte sorgen dafür,
            // dass eine echte Crash-Schleife trotzdem auffällt, statt endlos zu rotieren:
            // Läuft der Prozess nach dem Start keine 30 s durch, wertet PM2 das als
            // Fehlstart; nach 15 Fehlstarts in Folge bleibt er gestoppt und "pm2 list"
            // zeigt "errored" statt einer stillen Dauerschleife.
            min_uptime: 30000,
            max_restarts: 15,
            restart_delay: 5000,

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
