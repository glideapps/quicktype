module Options
    ( OptionValue(..)
    , Option
    , OptionValues
    , Options
    , booleanOptionValue
    ) where

import Prelude

import Data.Maybe (fromJust)
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Partial.Unsafe (unsafePartial)

-- FIXME: all of this should be strongly typed and not require
-- unsafePartial.

data OptionValue
    = BooleanValue Boolean

type Option =
    { description :: String
    , default :: OptionValue
    }

type Options = StrMap Option
type OptionValues = StrMap OptionValue

booleanOptionValue :: String -> OptionValues -> Boolean
booleanOptionValue name values =
    extract $ unsafePartial $ fromJust $ SM.lookup name values
    where extract (BooleanValue v) = v
