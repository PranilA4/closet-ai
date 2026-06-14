import { PropsWithChildren, useRef } from 'react';
import {
  Animated,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';

type Props = PropsWithChildren<PressableProps & {
  containerStyle?: StyleProp<ViewStyle>;
  hoverLift?: number;
  hoverScale?: number;
  pressScale?: number;
}>;

export function MotionPressable({
  children,
  containerStyle,
  hoverLift = 3,
  hoverScale = 1.015,
  pressScale = 0.97,
  onHoverIn,
  onHoverOut,
  onPressIn,
  onPressOut,
  ...props
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const animate = (nextScale: number, nextLift: number) => Animated.parallel([
    Animated.spring(scale, { toValue: nextScale, useNativeDriver: true, damping: 16, stiffness: 220 }),
    Animated.spring(lift, { toValue: nextLift, useNativeDriver: true, damping: 16, stiffness: 220 }),
  ]).start();

  return (
    <Animated.View style={[containerStyle, { transform: [{ translateY: lift }, { scale }] }]}>
      <Pressable
        {...props}
        onHoverIn={(event) => { animate(hoverScale, -hoverLift); onHoverIn?.(event); }}
        onHoverOut={(event) => { animate(1, 0); onHoverOut?.(event); }}
        onPressIn={(event) => { animate(pressScale, 0); onPressIn?.(event); }}
        onPressOut={(event) => { animate(1, 0); onPressOut?.(event); }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
