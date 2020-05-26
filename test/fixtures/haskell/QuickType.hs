module QuickType where

import Data.ByteString.Lazy (ByteString)

type TopLevel = Int

decodeTopLevel :: ByteString -> Maybe TopLevel
decodeTopLevel = undefined
