import { utf16LegalizeCharacters } from "../../support/Strings";

import { isES3IdentifierPart } from "./unicodeMaps";

export const legalizeName = utf16LegalizeCharacters(isES3IdentifierPart);
