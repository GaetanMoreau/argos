import { overview } from '../../../src/core/queries.ts';

export default defineEventHandler(() => overview(useArgosDb()));
