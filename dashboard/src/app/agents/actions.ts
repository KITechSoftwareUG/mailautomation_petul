'use server';
import fs from 'fs/promises';
import path from 'path';

const PROMPTS_DIR = path.join(process.cwd(), '..', 'prompts');

export async function getPrompts() {
    const files = await fs.readdir(PROMPTS_DIR);
    const prompts = [];
    for (const file of files) {
        if (file.endsWith('.md')) {
            const content = await fs.readFile(path.join(PROMPTS_DIR, file), 'utf-8');
            prompts.push({ name: file, content });
        }
    }
    return prompts.sort((a, b) => a.name.localeCompare(b.name));
}

export async function savePrompt(name: string, content: string) {
    const filePath = path.join(PROMPTS_DIR, name);
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
}
