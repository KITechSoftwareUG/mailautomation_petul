import fs from 'fs';
import path from 'path';

/**
 * CENTRAL AGENT PROMPTS – Petul Mail Automation
 * 
 * Diese Datei liest die Prompts aus dem /prompts Verzeichnis ein.
 * Das ermöglicht es dir, die Anweisungen für die Agenten direkt in den 
 * .md Dateien zu bearbeiten, ohne den Code anzufassen.
 */

const promptsDir = path.join(__dirname, '../../prompts');

export const getPrompt = (filename: string): string => {
    try {
        return fs.readFileSync(path.join(promptsDir, filename), 'utf-8');
    } catch (error) {
        console.error(`Fehler beim Lesen des Prompts ${filename}:`, error);
        return '';
    }
};

// Hilfsfunktionen für die Agenten
export const getIntentPrompt = () => getPrompt('01_intent.md');
export const getPolicyPrompt = () => getPrompt('02_policy.md');
export const getActionPrompt = () => getPrompt('03_action.md');
