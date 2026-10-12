package app.rezka.tv;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;

final class TVControls {
    static StateListDrawable buttonBackground(Context context){
        StateListDrawable states=new StateListDrawable();
        states.addState(new int[]{android.R.attr.state_focused},shape(context,0xFF34363F,true));
        states.addState(new int[]{android.R.attr.state_pressed},shape(context,0xFF34363F,true));
        states.addState(new int[]{android.R.attr.state_selected},shape(context,0xFF34343D,false));
        states.addState(new int[]{},shape(context,0xFF25272E,false));
        return states;
    }
    private static GradientDrawable shape(Context context,int color,boolean focused){float density=context.getResources().getDisplayMetrics().density;GradientDrawable shape=new GradientDrawable();shape.setColor(color);shape.setCornerRadius(10*density);if(focused)shape.setStroke(Math.round(2*density),0xFFFFFFFF);return shape;}
}
