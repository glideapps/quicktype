module Utils
    ( mapM
    , mapMapM
    , mapStrMapM
    , mapMaybeM
    , sortByKeyM
    , sortByKey
    , lookupOrDefault
    , removeElement
    , forEnumerated_
    , forStrMap_
    , forMapM
    , forMapM_
    ) where

import Prelude

import Data.Array as A
import Data.Either (Either(..), either)
import Data.Foldable (find, foldr, traverse_)
import Data.List (List, (:))
import Data.List as L
import Data.Map (Map)
import Data.Map as M
import Data.Maybe (Maybe(..), maybe)
import Data.Set (Set)
import Data.Set as S
import Data.StrMap (StrMap)
import Data.StrMap as SM
import Data.Traversable (class Foldable, class Traversable, for_, traverse)
import Data.Tuple (Tuple(..))

mapM :: forall m a b t. Applicative m => Traversable t => (a -> m b) -> t a -> m (t b)
mapM = traverse

forMapM :: forall a v k m. Monad m => Ord k => Map k v -> (k -> v -> m a) -> m (Map k a)
forMapM = flip mapMapM

forMapM_ :: forall a v k m. Monad m => Ord k => Map k v -> (k -> v -> m a) -> m Unit
forMapM_ m f = do
    _ <- forMapM m f
    pure unit

mapMapM :: forall m k v w. Monad m => Ord k  => (k -> v -> m w) -> Map k v -> m (Map k w)
mapMapM f m = do
    arr <- mapM mapper (M.toUnfoldable m :: Array _)
    pure $ M.fromFoldable arr
    where
        mapper (Tuple a b) = do
            c <- f a b
            pure $ Tuple a c

mapStrMapM :: forall m v w. Monad m => (String -> v -> m w) -> StrMap v -> m (StrMap w)
mapStrMapM f m = do
    arr <- mapM mapper (SM.toUnfoldable m :: Array _)
    pure $ SM.fromFoldable arr
    where
        mapper (Tuple a b) = do
            c <- f a b
            pure $ Tuple a c

mapMaybeM :: forall m a b. Monad m => (a -> m b) -> Maybe a -> m (Maybe b)
mapMaybeM f (Just x) = Just <$> f x
mapMaybeM _ _ = pure Nothing

sortByKey :: forall a b. Ord b => (a -> b) -> List a -> List a
sortByKey keyF = L.sortBy (\a b -> compare (keyF a) (keyF b))

sortByKeyM :: forall a b m. Ord b => Monad m => (a -> m b) -> List a -> m (List a)
sortByKeyM keyF items = do
    itemsWithKeys :: List _ <- mapM (\item -> keyF item >>= (\key -> pure $ { item, key })) items
    let sortedItemsWithKeys = L.sortBy (\a b -> compare a.key b.key) itemsWithKeys
    pure $ map (_.item) sortedItemsWithKeys

lookupOrDefault :: forall k v. Ord k => v -> k -> Map k v -> v
lookupOrDefault default key m = maybe default id $ M.lookup key m

removeElement :: forall a. Ord a => (a -> Boolean) -> Set a -> { element :: Maybe a, rest :: Set a }
removeElement p s = { element, rest: maybe s (\x -> S.delete x s) element }
    where element = find p s 

forEnumerated_ :: forall a b m. Applicative m => List a -> (Int -> a -> m b) -> m Unit
forEnumerated_ l f =
    let lWithIndexes = L.zip (L.range 0 ((L.length l) - 1)) l
    in
        for_ lWithIndexes \(Tuple i x) -> f i x

forStrMap_ :: forall a b m. Applicative m => StrMap a -> (String -> a -> m b) -> m Unit
forStrMap_ sm f =
    let arr = SM.toUnfoldable sm :: Array _
    in
        for_ arr \(Tuple n v) -> f n v
