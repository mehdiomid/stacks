import { z } from 'zod';

// Zod otherwise probes for eval() (new Function), which the page's Content-Security-Policy forbids;
// Firefox logs that as an error. Must run before any schema is defined, so main.tsx imports this first.
z.config({ jitless: true });
