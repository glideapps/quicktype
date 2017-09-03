module Core
    ( module Prelude
    , module Data.Maybe
    , module Data.Either
    , Error, SourceCode, Name
    ) where

import Prelude

import Data.Either(Either(..), either)
import Data.Maybe(Maybe(..), maybe)

type Error = String
type SourceCode = String
type Name = String
