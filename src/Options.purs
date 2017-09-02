module Options
    ( OptionValue(..)
    , Option
    , OptionValues
    , Options
    , booleanOptionValue
    ) where

import Prelude

import Data.Map (Map)
import Data.Map as M
import Data.Maybe (fromJust)
import Partial.Unsafe (unsafePartial)

-- FIXME: all of this should be strongly typed and not require
-- unsafePartial.

data OptionValue
    = BooleanValue Boolean

type Option =
    { description :: String
    , default :: OptionValue
    }

type Options = Map String Option
type OptionValues = Map String OptionValue

booleanOptionValue :: String -> OptionValues -> Boolean
booleanOptionValue name values =
    extract $ unsafePartial $ fromJust $ M.lookup name values
    where extract (BooleanValue v) = v
