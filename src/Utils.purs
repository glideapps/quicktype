module Utils
    ( mapM
    ) where

import Prelude

import Data.List (List, (:))
import Data.List as L

-- FIXME: doesn't really belong here
mapM :: forall m a b. Monad m => (a -> m b) -> List a -> m (List b)
mapM _ L.Nil = pure L.Nil
mapM f (x : xs) = L.Cons <$> f x <*> mapM f xs