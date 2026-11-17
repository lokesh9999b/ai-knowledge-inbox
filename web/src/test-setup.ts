import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

// Registered here (instead of '@testing-library/jest-dom/vitest') so `vitest` is resolved from this
// workspace; in the npm workspace layout jest-dom is hoisted to the root and cannot see it.
expect.extend(matchers);
